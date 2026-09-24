// ─── fetch_model_config.js — download, verify, freeze a model's real config.json ──
//
// "We don't really vendor. We download, verify, freeze." -- this is that
// pipeline for model architecture data, same discipline as kanji.js's real
// Joyo download (verified 2136/2136 before freezing) and semantics.js's
// DIGIT_BLOCKS (derived from verified real code points, not hand-typed).
//
// Downloads a real Hugging Face model's config.json (the standardized,
// machine-readable transformers AutoConfig format -- NOT the prose Model
// Card, which is unstructured and inconsistent across repos), verifies the
// fields the simulator's shape-derivation logic actually depends on are
// present and sane, then freezes the verified result into data/models/.
//
// Usage: node fetch_model_config.js <hf-org>/<hf-repo> [output-name]
// Example: node fetch_model_config.js Qwen/Qwen2.5-0.5B qwen2.5-0.5b
var https = require('https');
var fs = require('fs');
var path = require('path');

var REQUIRED_FIELDS = [
  'hidden_size',        // model dimension (d_model)
  'num_hidden_layers',  // transformer block count
  'num_attention_heads',// query heads
  'intermediate_size',  // FFN hidden dimension
  'vocab_size'          // output/embedding vocabulary size
];

function fetchJson(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: { 'User-Agent': 'llm-simulator-fetch/1.0' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchJson(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
        return;
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error('invalid JSON from ' + url + ': ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

// Verification: the fields the simulator's matmul-shape derivation actually
// reads must exist and be sane -- not just "did the download succeed."
// Same principle as kanji.js checking 2136/2136 rather than trusting a
// non-empty result.
function verify(config, repoId) {
  var errors = [];

  REQUIRED_FIELDS.forEach(function(field) {
    if (typeof config[field] !== 'number' || !(config[field] > 0)) {
      errors.push('missing or non-positive required field: ' + field);
    }
  });
  if (errors.length) throw new Error('verify(' + repoId + ') failed:\n  ' + errors.join('\n  '));

  // num_key_value_heads defaults to num_attention_heads when absent (real
  // transformers AutoConfig behavior for MHA-only architectures that
  // predate GQA) -- not an error, but must be resolved explicitly so
  // downstream shape math never silently assumes uniform heads.
  var kvHeads = typeof config.num_key_value_heads === 'number'
    ? config.num_key_value_heads
    : config.num_attention_heads;

  if (kvHeads > config.num_attention_heads) {
    errors.push('num_key_value_heads (' + kvHeads + ') exceeds num_attention_heads (' + config.num_attention_heads + ')');
  }
  if (config.num_attention_heads % kvHeads !== 0) {
    errors.push('num_attention_heads (' + config.num_attention_heads + ') is not an integer multiple of num_key_value_heads (' + kvHeads + ') -- GQA grouping must divide evenly');
  }
  if (config.hidden_size % config.num_attention_heads !== 0) {
    errors.push('hidden_size (' + config.hidden_size + ') is not an integer multiple of num_attention_heads (' + config.num_attention_heads + ') -- head_dim must be an integer');
  }

  if (errors.length) throw new Error('verify(' + repoId + ') failed:\n  ' + errors.join('\n  '));

  return {
    hiddenSize: config.hidden_size,
    numHiddenLayers: config.num_hidden_layers,
    numAttentionHeads: config.num_attention_heads,
    numKeyValueHeads: kvHeads,
    headDim: config.hidden_size / config.num_attention_heads,
    intermediateSize: config.intermediate_size,
    vocabSize: config.vocab_size,
    maxPositionEmbeddings: config.max_position_embeddings || null,
    modelType: config.model_type || null,
    architectures: config.architectures || null,
    torchDtype: config.torch_dtype || null
  };
}

async function main() {
  var repoId = process.argv[2];
  var outputName = process.argv[3] || repoId.split('/')[1].toLowerCase();
  if (!repoId) {
    console.error('usage: node fetch_model_config.js <hf-org>/<hf-repo> [output-name]');
    process.exit(1);
  }

  var url = 'https://huggingface.co/' + repoId + '/raw/main/config.json';
  console.log('fetching ' + url);
  var rawConfig = await fetchJson(url);

  console.log('verifying required fields + GQA/head-dim sanity...');
  var shape = verify(rawConfig, repoId);
  console.log('PASS  all required fields present and sane');
  console.log('  hiddenSize=' + shape.hiddenSize + ' layers=' + shape.numHiddenLayers +
    ' attnHeads=' + shape.numAttentionHeads + ' kvHeads=' + shape.numKeyValueHeads +
    ' headDim=' + shape.headDim + ' (GQA ratio ' + (shape.numAttentionHeads / shape.numKeyValueHeads) + ':1)');

  var frozen = {
    sourceRepo: repoId,
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    shape: shape,
    rawConfig: rawConfig // full original response kept for future fields the shape extractor doesn't use yet
  };

  var outPath = path.join(__dirname, '..', 'data', 'models', outputName + '.json');
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2) + '\n');
  console.log('FROZEN -> ' + outPath);
}

main().catch(function(e) { console.error('FAIL: ' + e.message); process.exit(1); });
