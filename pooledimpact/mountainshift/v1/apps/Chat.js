class Chat {

  // Context windows by account tier
  static CONTEXT = {
    free:       200000,
    pro:        200000,   // same window, higher rate limits
    team:       200000,
    enterprise: 200000,
  };

  // Empirical chars-per-pixel for claude.ai's center column (~700px wide)
  // Calibrated: body.innerText / scrollHeight of conversation container
  // Adjust SCROLL_CAL if your font size differs from default 15px
  static SCROLL_CAL = 2.8;  // chars per scroll-pixel in claude.ai column

  // ── Load ─────────────────────────────────────────────────────────────

  static load() {
    const turns = [];

    // claude.ai uses a single scrollable column — grab all text nodes
    // that represent human/assistant turns
    const strategies = [
      // Strategy 1: data-testid attributes
      () => document.querySelectorAll('[data-testid*="human-turn"], [data-testid*="assistant-turn"]'),
      // Strategy 2: class fragments
      () => document.querySelectorAll('[class*="HumanTurn"], [class*="AssistantTurn"]'),
      // Strategy 3: role attributes
      () => document.querySelectorAll('[data-role="user"], [data-role="assistant"]'),
      // Strategy 4: generic message containers
      () => document.querySelectorAll('[class*="message-content"], [class*="MessageContent"]'),
      // Strategy 5: prose containers inside the chat column
      () => {
        const main = document.querySelector('main') || document.querySelector('[class*="chat"]');
        return main ? main.querySelectorAll(':scope > div > div') : [];
      },
    ];

    let nodes = [];
    for (const strategy of strategies) {
      try {
        const found = Array.from(strategy());
        if (found.length > 0) { nodes = found; break; }
      } catch(e) {}
    }

    // Final fallback — full body text, no turn breakdown
    if (nodes.length === 0) {
      return [{
        role:       'unknown',
        text:       document.body.innerText || '',
        html:       '',
        node:       document.body,
        charCount:  (document.body.innerText || '').length,
        hasCode:    document.querySelectorAll('pre, code').length > 0,
        imageCount: document.querySelectorAll('img').length,
        toolBlocks: Chat._countAllToolBlocks(),
        isFallback: true,
      }];
    }

    for (const node of nodes) {
      const role = Chat._detectRole(node);
      const text = node.innerText || node.textContent || '';
      turns.push({
        role,
        text:       text.trim(),
        html:       node.innerHTML || '',
        node,
        charCount:  text.trim().length,
        hasCode:    node.querySelector('pre, code') !== null,
        imageCount: node.querySelectorAll('img').length,
        toolBlocks: Chat._countToolBlocks(node),
      });
    }

    return turns;
  }

  // ── Parse ─────────────────────────────────────────────────────────────

  static parse(turns) {
    return turns.map(turn => {
      const segments = Chat._segmentContent(turn.text, turn.html);
      return {
        ...turn,
        segments,
        breakdown: {
          proseChars: segments.filter(s => s.type === 'prose').reduce((n, s) => n + s.text.length, 0),
          codeChars:  segments.filter(s => s.type === 'code').reduce((n, s)  => n + s.text.length, 0),
          toolChars:  segments.filter(s => s.type === 'tool').reduce((n, s)  => n + s.text.length, 0),
        },
      };
    });
  }

  // ── EstimateTokens (scroll) ───────────────────────────────────────────
  // Uses scroll height × calibrated chars-per-pixel multiplier.
  // Ground truth: body.innerText.length / 4 anchors the calibration.

  static estimateTokens(scroll = true) {
    // Always compute body-text ground truth
    const bodyText    = document.body.innerText || '';
    const bodyChars   = bodyText.length;
    const bodyTokens  = Math.round(bodyChars / 4);

    if (!scroll) {
      return {
        method:          'body-text',
        estimatedChars:  bodyChars,
        estimatedTokens: bodyTokens,
        contextPercent:  Chat._contextPercent(bodyTokens),
        warning:         Chat._warning(bodyTokens),
      };
    }

    const container   = Chat._findScrollContainer();
    const scrollH     = container ? container.scrollHeight : document.documentElement.scrollHeight;

    // Calibrate multiplier against body-text ground truth
    // If we have body chars, derive actual chars-per-pixel for this session
    const calibrated  = scrollH > 0 ? bodyChars / scrollH : Chat.SCROLL_CAL;
    const estChars    = scrollH * calibrated;
    const estTokens   = Math.round(estChars / 4);

    return {
      method:           'scroll',
      scrollHeight:     scrollH,
      charsPerPx:       calibrated.toFixed(3),
      estimatedChars:   Math.round(estChars),
      estimatedTokens:  estTokens,
      bodyGroundTruth:  bodyTokens,
      contextPercent:   Chat._contextPercent(estTokens),
      warning:          Chat._warning(estTokens),
    };
  }

  // ── Estimate (content) ────────────────────────────────────────────────

  static estimate(turns) {
    if (!turns || turns.length === 0) {
      turns = Chat.parse(Chat.load());
    }

    // If fallback (no turns found) use body text directly
    if (turns.length === 1 && turns[0].isFallback) {
      const chars  = turns[0].charCount;
      const tokens = Math.round(chars / 4);
      return {
        method:         'body-fallback',
        turns:          0,
        totalTokens:    tokens,
        breakdown:      { system: 0, prose: tokens, code: 0, tool: 0, images: 0 },
        contextPercent: Chat._contextPercent(tokens),
        warning:        Chat._warning(tokens),
        perTurn:        0,
      };
    }

    let proseTokens = 0;
    let codeTokens  = 0;
    let imageTokens = 0;
    const systemTokens = 2000;

    for (const turn of turns) {
      const bd = turn.breakdown || {};
      proseTokens += Math.round((bd.proseChars || 0) / 4);
      codeTokens  += Math.round((bd.codeChars  || 0) / 3);
      imageTokens += (turn.imageCount || 0) * 1600;
    }

    // TOOL TOKENS — aggregate ALL tool usage across entire conversation
    // Each tool call: ~50 tokens for signature + params
    // Each tool result: chars / 3 (JSON/structured output)
    const allToolNodes = Array.from(document.querySelectorAll(
      '[class*="tool"], [class*="Tool"], [class*="function-call"], ' +
      '[class*="FunctionCall"], details, [data-testid*="tool"]'
    ));
    let toolCharsTotal = 0;
    let toolCallCount  = 0;
    allToolNodes.forEach(n => {
      const t = (n.innerText || n.textContent || '').trim();
      if (t.length > 10) {
        toolCharsTotal += t.length;
        toolCallCount++;
      }
    });
    const toolTokens = Math.round(toolCharsTotal / 3) + (toolCallCount * 50);

    const totalTokens = systemTokens + proseTokens + codeTokens + toolTokens + imageTokens
                      + (turns.length * 4); // per-turn overhead

    return {
      method:         'content',
      turns:          turns.length,
      totalTokens,
      toolCallCount,
      breakdown: {
        system:  systemTokens,
        prose:   proseTokens,
        code:    codeTokens,
        tool:    toolTokens,
        images:  imageTokens,
      },
      contextPercent: Chat._contextPercent(totalTokens),
      warning:        Chat._warning(totalTokens),
      perTurn:        Math.round(totalTokens / Math.max(1, turns.length)),
    };
  }

  // ── Analyzed ─────────────────────────────────────────────────────────

  static analyzed() {
    const turns   = Chat.load();
    const parsed  = Chat.parse(turns);
    const content = Chat.estimate(parsed);
    const scroll  = Chat.estimateTokens(true);

    // Use body ground truth as the most reliable single number
    const bestEstimate = scroll.bodyGroundTruth || content.totalTokens;

    const turnDetail = parsed
      .filter(t => !t.isFallback)
      .map((t, i) => ({
        turn:   i + 1,
        role:   t.role,
        tokens: Math.round(
          (t.breakdown.proseChars / 4) +
          (t.breakdown.codeChars  / 3) +
          (t.imageCount * 1600) + 4
        ),
        hasCode: t.hasCode,
        images:  t.imageCount,
        tools:   t.toolBlocks,
      }));

    const heaviest = [...turnDetail].sort((a, b) => b.tokens - a.tokens).slice(0, 5);

    const report = {
      summary: {
        bestEstimate,
        totalTokens:    content.totalTokens,
        scrollEstimate: scroll.estimatedTokens,
        bodyGroundTruth: scroll.bodyGroundTruth,
        turns:          turns.filter(t => !t.isFallback).length,
        toolCallCount:  content.toolCallCount,
        contextPercent: Chat._contextPercent(bestEstimate),
        warning:        Chat._warning(bestEstimate),
        perTurn:        content.perTurn,
      },
      breakdown:     content.breakdown,
      heaviestTurns: heaviest,
      scrollProxy:   scroll,
      content,
      accountInfo:   Chat._accountInfo(bestEstimate),
    };

    Chat._printReport(report);
    return report;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  static _detectRole(node) {
    const cls  = (node.className || '').toLowerCase();
    const attr = (node.getAttribute('data-testid') || '').toLowerCase();
    const txt  = cls + ' ' + attr;
    if (txt.includes('human') || txt.includes('user'))       return 'user';
    if (txt.includes('assistant') || txt.includes('claude')) return 'assistant';
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children) : [];
    return siblings.indexOf(node) % 2 === 0 ? 'user' : 'assistant';
  }

  static _countToolBlocks(node) {
    return node.querySelectorAll('pre, code, details, [class*="tool"], [class*="result"]').length;
  }

  static _countAllToolBlocks() {
    return document.querySelectorAll('details, [class*="tool-call"], [class*="ToolCall"]').length;
  }

  static _segmentContent(text, html) {
    const segments = [];
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const codeTexts = new Set();
    tmp.querySelectorAll('pre, code').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length > 0) { codeTexts.add(t); segments.push({ type: 'code', text: t }); }
    });

    tmp.querySelectorAll('details, [class*="tool"], [class*="result"]').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length > 0) segments.push({ type: 'tool', text: t });
    });

    let prose = text;
    codeTexts.forEach(ct => { prose = prose.replace(ct, ''); });
    if (prose.trim().length > 0) segments.push({ type: 'prose', text: prose.trim() });

    return segments;
  }

  static _findScrollContainer() {
    const candidates = [
      document.querySelector('[class*="conversation"]'),
      document.querySelector('[class*="messages"]'),
      document.querySelector('main'),
      document.documentElement,
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > window.innerHeight * 1.5) return el;
    }
    return document.documentElement;
  }

  static _contextPercent(tokens) {
    return Math.round((tokens / Chat.CONTEXT.free) * 100);
  }

  static _warning(tokens) {
    const pct = Chat._contextPercent(tokens);
    if (pct >= 90) return '🔴 CRITICAL — context nearly full';
    if (pct >= 75) return '🟠 HIGH — approaching limit';
    if (pct >= 50) return '🟡 MODERATE — halfway through window';
    if (pct >= 25) return '🟢 LOW — plenty remaining';
    return '🟢 FRESH — early in conversation';
  }

  static _accountInfo(tokens) {
    const remaining = Chat.CONTEXT.free - tokens;
    return {
      contextWindow:    Chat.CONTEXT.free.toLocaleString(),
      tokensUsed:       tokens.toLocaleString(),
      tokensRemaining:  Math.max(0, remaining).toLocaleString(),
      percentUsed:      Chat._contextPercent(tokens) + '%',
      note:             'Free and Pro share the same 200k window. Pro adds rate limits and priority.',
    };
  }

  static _printReport(report) {
    const s = report.summary;
    const b = report.breakdown;
    const a = report.accountInfo;
    console.group('📊 Chat Token Analysis');
    console.log('─'.repeat(44));
    console.log(`Best estimate (body text):  ~${s.bodyGroundTruth?.toLocaleString()}`);
    console.log(`Content analysis:           ~${s.totalTokens.toLocaleString()}`);
    console.log(`Scroll estimate:            ~${s.scrollEstimate.toLocaleString()}`);
    console.log(`Context window used:        ${s.contextPercent}%  ${s.warning}`);
    console.log(`Tokens remaining:           ~${a.tokensRemaining}`);
    console.log(`Turns detected:             ${s.turns}`);
    console.log(`Tool calls total:           ${s.toolCallCount}`);
    console.log(`Avg tokens/turn:            ~${s.perTurn}`);
    console.log('─'.repeat(44));
    console.log('Breakdown:');
    console.log(`  System overhead:  ~${b.system?.toLocaleString()}`);
    console.log(`  Prose:            ~${b.prose?.toLocaleString()}`);
    console.log(`  Code:             ~${b.code?.toLocaleString()}`);
    console.log(`  Tool (total):     ~${b.tool?.toLocaleString()}`);
    console.log(`  Images:           ~${b.images?.toLocaleString()}`);
    console.log('─'.repeat(44));
    console.log('Account:');
    console.log(`  Window:    ${a.contextWindow} tokens (Free = Pro)`);
    console.log(`  Used:      ${a.tokensUsed}`);
    console.log(`  Remaining: ${a.tokensRemaining}`);
    console.log(`  Note:      ${a.note}`);
    if (report.heaviestTurns?.length > 0) {
      console.log('─'.repeat(44));
      console.log('Heaviest turns:');
      report.heaviestTurns.forEach(t => {
        const flags = [
          t.hasCode  ? 'code'         : '',
          t.images   ? t.images+'img' : '',
          t.tools    ? t.tools+'tool' : '',
        ].filter(Boolean).join(', ');
        console.log(`  Turn ${String(t.turn).padStart(3)} [${t.role}]: ~${t.tokens.toLocaleString()} tokens${flags?' ('+flags+')':''}`);
      });
    }
    console.groupEnd();
  }
}

// Auto-run when pasted into DevTools
Chat.analyzed();
