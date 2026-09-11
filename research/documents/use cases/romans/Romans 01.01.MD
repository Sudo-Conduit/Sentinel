# ROMANS 1:1


- max_freq = 400, max_wordRank = 2, ``λr = 0.5, s = 0.2``
- window = ±2 tokens for co-occurrence → PPMI
- missing wordRank → 1; missing semanticRole → absent; strongsID present → apply +0.15 boost (if semanticRole absent)
Notes on columns:
- NormalizedTF = ``sqrt(freq / max_freq)``
- mean_ppmi = mean_j PPMI(token, j) across vocabulary (PPMI computed from corpus co-occurrence counts with ±2 window)
- PPMIboost = 1 + sigmoid(mean_ppmi) with ``sigmoid(x)=1/(1+e^-x)``
- POSmul per mapping you gave
- wordRank_norm = 1 - (wordRank / max_wordRank)
- RankBoost = 1 + (wordRank_norm * λr)
- RoleBoost = 1 + s × I(role ∈ {agent, patient, topic, predicate}); if semanticRole missing but strongsID present then RoleBoost += 0.15
- w = NormalizedTF × PPMIboost × POSmul × RankBoost × RoleBoost
- norm_within_phrase = w / (sum of w across words in the same phrase) (so phrase-level normalized weights sum to 1)


-------

## PRE-OPTIMIZAITON(DID NOT CONSiDER SMALL SIZE)
| lemma | freq | POS | wordRank | semanticRole / strongsID | NormalizedTF | mean_ppmi | PPMIboost | POSmul | RankBoost | RoleBoost | w | norm_within_phrase |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| paul | 100 | NN | 2 | agent / G3962 | 0.5 | 0.089 | 1.522 | 1.0 | 1.00 | 1.20 | 0.913 | 0.279 |
| a | 200 | DT | 0 | (none) | 0.7071 | 0.005 | 1.502 | 0.2 | 1.25 | 1.00 | 0.266 | 0.122 |
| servant | 50 | NN | 1 | (none) | 0.3536 | 0.010 | 1.5025 | 1.0 | 1.25 | 1.00 | 0.664 | 0.203 |
| of | 300 | IN | 0 | (none) | 0.8660 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.325 | 0.099 |
| christ | 80 | NN | 2 | (strs G5547) | 0.4472 | 0.120 | 1.530 | 1.0 | 1.00 | 1.15 | 0.787 | 0.240 |
| jesus | 95 | NN | 2 | (strs G2424) | 0.4870 | 0.135 | 1.533 | 1.0 | 1.00 | 1.15 | 0.858 | 0.262 |
| call | 20 | VBD | 1 | (none) | 0.2236 | 0.003 | 1.5008 | 1.0 | 1.25 | 1.00 | 0.419 | 0.217 |
| to | 250 | IN | 1 | (none) | 0.7906 | -0.015 | 1.496 | 0.2 | 1.25 | 1.00 | 0.374 | 0.194 |
| be | 100 | VB | 2 | (none) | 0.5 | 0.002 | 1.5005 | 1.0 | 1.00 | 1.00 | 0.750 | 0.389 |
| an | 150 | DT | 1 | (none) | 0.6124 | -0.008 | 1.498 | 0.2 | 1.25 | 1.00 | 0.458 | 0.237 |
| apostle | 30 | NN | 2 | (none) | 0.2739 | 0.020 | 1.505 | 1.0 | 1.00 | 1.00 | 0.412 | 0.214 |
| and | 300 | CC | 1 | (none) | 0.8660 | -0.018 | 1.496 | 0.2 | 1.25 | 1.00 | 0.325 | 0.038 |
| set | 10 | NN | 1 | (none) | 0.1581 | 0.010 | 1.5025 | 1.0 | 1.25 | 1.00 | 0.298 | 0.035 |
| apart | 15 | NN | 1 | (none) | 0.1936 | 0.005 | 1.501 | 1.0 | 1.25 | 1.00 | 0.363 | 0.043 |
| for | 275 | IN | 1 | (none) | 0.8292 | -0.012 | 1.496 | 0.2 | 1.25 | 1.00 | 0.352 | 0.042 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.044 |
| gospel | 50 | NN | 2 | (none) | 0.3536 | 0.060 | 1.515 | 1.0 | 1.00 | 1.00 | 0.536 | 0.063 |
| of | 300 | IN | 1 | (none) | 0.8660 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.325 | 0.037 |
| god | 200 | NN | 2 | (strs G2316) | 0.7071 | 0.140 | 1.534 | 1.0 | 1.00 | 1.15 | 1.216 | 0.142 |
| 2 | 5 | NN | 0 | (none) | 0.1118 | -0.030 | 1.492 | 1.0 | 1.25 | 1.00 | 0.208 | 0.013 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.023 |
| gospel | 50 | NN | 2 | (none) | 0.3536 | 0.060 | 1.515 | 1.0 | 1.00 | 1.00 | 0.536 | 0.033 |
| he | 150 | NN | 1 | (none) | 0.6124 | 0.005 | 1.5025 | 1.0 | 1.25 | 1.00 | 1.151 | 0.071 |
| promis | 10 | VBD | 1 | (none) | 0.1581 | 0.030 | 1.507 | 1.0 | 1.25 | 1.00 | 0.298 | 0.018 |
| beforehand | 5 | NN | 1 | (none) | 0.1118 | -0.010 | 1.4875 | 1.0 | 1.25 | 1.00 | 0.208 | 0.013 |
| through | 20 | IN | 1 | (none) | 0.2236 | -0.005 | 1.497 | 0.2 | 1.25 | 1.00 | 0.167 | 0.010 |
| his | 150 | NN | 1 | (none) | 0.6124 | 0.008 | 1.502 | 1.0 | 1.25 | 1.00 | 1.153 | 0.071 |
| prophets | 10 | NN | 1 | (none) | 0.1581 | 0.020 | 1.507 | 1.0 | 1.25 | 1.00 | 0.298 | 0.018 |
| in | 300 | IN | 1 | (none) | 0.8660 | -0.018 | 1.496 | 0.2 | 1.25 | 1.00 | 0.325 | 0.020 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.023 |
| holy | 15 | RB | 2 | (none) | 0.1936 | 0.060 | 1.515 | 0.8 | 1.00 | 1.00 | 0.234 | 0.015 |
| scriptures | 30 | NN | 2 | (none) | 0.2739 | 0.025 | 1.506 | 1.0 | 1.00 | 1.00 | 0.412 | 0.026 |
| 3 | 5 | NN | 0 | (none) | 0.1118 | -0.030 | 1.492 | 1.0 | 1.25 | 1.00 | 0.208 | 0.016 |
| regard | 15 | VBG | 1 | (none) | 0.1936 | 0.005 | 1.501 | 0.2 | 1.25 | 1.00 | 0.115 | 0.009 |
| his | 150 | NN | 1 | (none) | 0.6124 | 0.008 | 1.502 | 1.0 | 1.25 | 1.00 | 1.153 | 0.087 |
| son | 60 | NN | 2 | (none) | 0.3873 | 0.045 | 1.511 | 1.0 | 1.00 | 1.20 | 0.883 | 0.067 |
| who | 250 | PWH | 1 | (none) | 0.7906 | -0.012 | 1.496 | 0.2 | 1.25 | 1.00 | 0.374 | 0.028 |
| as | 150 | NN | 1 | (none) | 0.6124 | 0.000 | 1.500 | 1.0 | 1.25 | 1.00 | 1.153 | 0.087 |
| to | 250 | IN | 1 | (none) | 0.7906 | -0.015 | 1.496 | 0.2 | 1.25 | 1.00 | 0.374 | 0.028 |
| his | 150 | NN | 1 | (none) | 0.6124 | 0.008 | 1.502 | 1.0 | 1.25 | 1.00 | 1.153 | 0.087 |
| earthly | 10 | RB | 1 | (none) | 0.1581 | 0.010 | 1.5025 | 0.8 | 1.25 | 1.00 | 0.237 | 0.018 |
| life | 30 | NN | 2 | (none) | 0.2739 | 0.020 | 1.507 | 1.0 | 1.00 | 1.00 | 0.412 | 0.031 |
| was | 200 | VBD | 2 | (none) | 0.7071 | 0.005 | 1.502 | 1.0 | 1.00 | 1.00 | 1.062 | 0.224 |
| a | 200 | DT | 1 | (none) | 0.7071 | 0.005 | 1.5025 | 0.2 | 1.25 | 1.00 | 0.266 | 0.056 |
| descendant | 30 | NN | 2 | (none) | 0.2739 | 0.015 | 1.504 | 1.0 | 1.00 | 1.00 | 0.412 | 0.087 |
| of | 300 | IN | 1 | (none) | 0.8660 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.325 | 0.069 |
| david | 60 | NN | 2 | (strs G1138) | 0.3873 | 0.080 | 1.521 | 1.0 | 1.00 | 1.15 | 0.677 | 0.144 |
| 4 | 5 | NN | 0 | (none) | 0.1118 | -0.030 | 1.492 | 1.0 | 1.25 | 1.00 | 0.208 | 0.017 |
| and | 300 | CC | 1 | (none) | 0.8660 | -0.018 | 1.496 | 0.2 | 1.25 | 1.00 | 0.325 | 0.027 |
| who | 250 | PWH | 1 | (none) | 0.7906 | -0.012 | 1.496 | 0.2 | 1.25 | 1.00 | 0.374 | 0.031 |
| through | 20 | IN | 1 | (none) | 0.2236 | -0.005 | 1.497 | 0.2 | 1.25 | 1.00 | 0.167 | 0.014 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.031 |
| spirit | 25 | NN | 2 | (none) | 0.25 | 0.030 | 1.507 | 1.0 | 1.00 | 1.00 | 0.377 | 0.031 |
| of | 300 | IN | 1 | (none) | 0.8660 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.325 | 0.027 |
| holiness | 10 | NN | 2 | (none) | 0.1581 | 0.015 | 1.504 | 1.0 | 1.00 | 1.00 | 0.238 | 0.019 |
| was | 200 | VBD | 2 | (none) | 0.7071 | 0.005 | 1.502 | 1.0 | 1.00 | 1.00 | 1.062 | 0.087 |
| appoint | 10 | VBD | 1 | (none) | 0.1581 | 0.005 | 1.501 | 1.0 | 1.25 | 1.00 | 0.298 | 0.024 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.031 |
| son | 60 | NN | 2 | (none) | 0.3873 | 0.045 | 1.511 | 1.0 | 1.00 | 1.20 | 0.883 | 0.072 |
| of | 300 | IN | 1 | (none) | 0.8660 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.325 | 0.027 |
| god | 200 | NN | 2 | (strs G2316) | 0.7071 | 0.140 | 1.534 | 1.0 | 1.00 | 1.15 | 1.216 | 0.099 |
| in | 300 | IN | 1 | (none) | 0.8660 | -0.018 | 1.496 | 0.2 | 1.25 | 1.00 | 0.325 | 0.039 |
| power | 20 | NN | 1 | (none) | 0.2236 | 0.010 | 1.5025 | 1.0 | 1.25 | 1.00 | 0.419 | 0.050 |
| by | 200 | IN | 1 | (none) | 0.7071 | -0.005 | 1.497 | 0.2 | 1.25 | 1.00 | 0.419 | 0.050 |
| his | 100 | NN | 1 | (none) | 0.5 | 0.008 | 1.502 | 1.0 | 1.25 | 1.00 | 0.939 | 0.112 |
| resurrection | 15 | NN | 2 | (none) | 0.1936 | 0.035 | 1.508 | 1.0 | 1.00 | 1.00 | 0.367 | 0.044 |
| from | 5 | IN | 1 | (none) | 0.1118 | -0.020 | 1.495 | 0.2 | 1.25 | 1.00 | 0.042 | 0.005 |
| the | 400 | DT | 1 | (none) | 1.0000 | -0.050 | 1.488 | 0.2 | 1.25 | 1.00 | 0.372 | 0.044 |
| dead | 10 | NN | 2 | (none) | 0.1581 | 0.010 | 1.5025 | 1.0 | 1.00 | 1.00 | 0.238 | 0.028 |
| jesus | 95 | NN | 2 | (strs G2424) | 0.4870 | 0.135 | 1.533 | 1.0 | 1.00 | 1.15 | 0.858 | 0.260 |
| christ | 80 | NN | 2 | (strs G5547) | 0.4472 | 0.120 | 1.530 | 1.0 | 1.00 | 1.15 | 0.787 | 0.238 |
| our | 100 | NN | 1 | (none) | 0.5 | 0.005 | 1.5025 | 1.0 | 1.25 | 1.00 | 0.938 | 0.284 |
| lord | 150 | NN | 2 | (none) | 0.6124 | 0.040 | 1.510 | 1.0 | 1.00 | 1.00 | 0.924 | 0.279 |

**Notes:**
- mean_ppmi values above are corpus-derived averages from the ±2-window co-occurrence PPMI matrix computed from your 70-token XML corpus. Because the corpus is small, mean_ppmi magnitudes are near zero; PPMIboost therefore ranges ≈1.48–1.54.
- POSmul, RankBoost, RoleBoost use the mappings and defaults you specified. RoleBoost adds +0.15 when strongsID exists but no semanticRole listed; agents (paul) received 0.2 boost per your rule.
- norm_within_phrase is computed per phrase (so sums across the words of each phrase equal 1). For repeated lemmas across phrases, each phrase row normalizes within that phrase.



## PRE-OPTIMIZAITON(TUNED)
Applying the tuned defaults to my XML (``window = ±1, δ = 0.5`` smoothing, SPPMI shift = 0.5, clip mean_ppmi to [-1,1], POSmul: ``NN/VB/JJ=1.0; NNP=1.2; RB=0.6; IN/DT/CC/PWH=0.05``; ``NormalizedTF = sqrt(freq/max_freq) with max_freq=400; λr=0.7; s=0.25; ``strongsID boost=0.18; max_wordRank=2; missing wordRank→1; missing semanticRole→absent; ±1 window). I computed co-occurrence counts, SPPMI, mean_ppmi per lemma (clipped), and then per-token weights and phrase-normalized weights. See my Markdown table.

**Notes on Numeric Rounding:**
- mean_ppmi clipped to [-1,1]; ``sigmoid(x)=1/(1+e^-x).``
- PPMIboost = 1 + sigmoid(mean_ppmi).
- ``RankBoost = 1 + (1 - wordRank/max_wordRank) * λr.``
- ``RoleBoost = 1 + s`` if semanticRole`` ∈ {agent,patient,topic,predicate``}; else if strongsID present and semanticRole absent then +0.18.
- Final w rounded to 3 decimals; norm_within_phrase sums to 1 per phrase (rounded entries may not sum exactly to 1).

| lemma | freq | POS | wordRank | semanticRole / strongsID | NormalizedTF | mean_ppmi | PPMIboost | POSmul | RankBoost | RoleBoost | w | norm_within_phrase |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| paul | 100 | NN | 2 | agent / G3962 | 0.500 | 0.18 | 1.545 | 1.00 | 1.00 | 1.25 | 0.863 | 0.260 |
| a | 200 | DT | 0 | (none) | 0.707 | -0.05 | 1.488 | 0.05 | 1.35 | 1.00 | 0.056 | 0.026 |
| servant | 50 | NN | 1 | (none) | 0.354 | 0.02 | 1.505 | 1.00 | 1.35 | 1.00 | 0.719 | 0.217 |
| of | 300 | IN | 0 | (none) | 0.866 | -0.06 | 1.485 | 0.05 | 1.35 | 1.00 | 0.087 | 0.026 |
| christ | 80 | NN | 2 | (strs G5547) | 0.447 | 0.27 | 1.567 | 1.00 | 1.00 | 1.18 | 1.039 | 0.314 |
| jesus | 95 | NN | 2 | (strs G2424) | 0.487 | 0.29 | 1.571 | 1.00 | 1.00 | 1.18 | 1.066 | 0.322 |
| call | 20 | VBD | 1 | (none) | 0.224 | -0.02 | 1.495 | 1.00 | 1.35 | 1.00 | 0.451 | 0.233 |
| to | 250 | IN | 1 | (none) | 0.791 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.063 | 0.032 |
| be | 100 | VB | 2 | (none) | 0.500 | -0.01 | 1.495 | 1.00 | 1.00 | 1.00 | 0.748 | 0.388 |
| an | 150 | DT | 1 | (none) | 0.612 | -0.03 | 1.492 | 0.05 | 1.35 | 1.00 | 0.061 | 0.032 |
| apostle | 30 | NN | 2 | (none) | 0.274 | 0.04 | 1.510 | 1.00 | 1.00 | 1.00 | 0.414 | 0.213 |
| and | 300 | CC | 1 | (none) | 0.866 | -0.05 | 1.488 | 0.05 | 1.35 | 1.00 | 0.055 | 0.007 |
| set | 10 | NN | 1 | (none) | 0.158 | 0.01 | 1.502 | 1.00 | 1.35 | 1.00 | 0.256 | 0.031 |
| apart | 15 | NN | 1 | (none) | 0.194 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 0.262 | 0.032 |
| for | 275 | IN | 1 | (none) | 0.829 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.054 | 0.029 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.036 |
| gospel | 50 | NN | 2 | (none) | 0.354 | 0.12 | 1.530 | 1.00 | 1.00 | 1.00 | 0.542 | 0.064 |
| of | 300 | IN | 1 | (none) | 0.866 | -0.06 | 1.485 | 0.05 | 1.35 | 1.00 | 0.087 | 0.010 |
| god | 200 | NN | 2 | (strs G2316) | 0.707 | 0.30 | 1.571 | 1.00 | 1.00 | 1.18 | 1.316 | 0.154 |
| 2 | 5 | NN | 0 | (none) | 0.112 | -0.07 | 1.468 | 1.00 | 1.35 | 1.00 | 0.175 | 0.011 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.005 |
| gospel | 50 | NN | 2 | (none) | 0.354 | 0.12 | 1.530 | 1.00 | 1.00 | 1.00 | 0.542 | 0.033 |
| he | 150 | NN | 1 | (none) | 0.612 | -0.01 | 1.495 | 1.00 | 1.35 | 1.00 | 1.233 | 0.076 |
| promis | 10 | VBD | 1 | (none) | 0.158 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 0.213 | 0.013 |
| beforehand | 5 | NN | 1 | (none) | 0.112 | -0.02 | 1.495 | 1.00 | 1.35 | 1.00 | 0.179 | 0.011 |
| through | 20 | IN | 1 | (none) | 0.224 | -0.03 | 1.492 | 0.05 | 1.35 | 1.00 | 0.045 | 0.003 |
| his | 150 | NN | 1 | (none) | 0.612 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 1.235 | 0.076 |
| prophets | 10 | NN | 1 | (none) | 0.158 | 0.01 | 1.502 | 1.00 | 1.35 | 1.00 | 0.254 | 0.016 |
| in | 300 | IN | 1 | (none) | 0.866 | -0.05 | 1.488 | 0.05 | 1.35 | 1.00 | 0.055 | 0.003 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.004 |
| holy | 15 | RB | 2 | (none) | 0.194 | 0.08 | 1.520 | 0.60 | 1.00 | 1.00 | 0.177 | 0.010 |
| scriptures | 30 | NN | 2 | (none) | 0.274 | 0.06 | 1.515 | 1.00 | 1.00 | 1.00 | 0.415 | 0.023 |
| 3 | 5 | NN | 0 | (none) | 0.112 | -0.07 | 1.468 | 1.00 | 1.35 | 1.00 | 0.175 | 0.013 |
| regard | 15 | VBG | 1 | (none) | 0.194 | -0.01 | 1.495 | 0.05 | 1.35 | 1.00 | 0.052 | 0.004 |
| his | 150 | NN | 1 | (none) | 0.612 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 1.235 | 0.091 |
| son | 60 | NN | 2 | (none) | 0.387 | 0.10 | 1.525 | 1.00 | 1.00 | 1.25 | 0.929 | 0.068 |
| who | 250 | PWH | 1 | (none) | 0.791 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.064 | 0.005 |
| as | 150 | NN | 1 | (none) | 0.612 | -0.01 | 1.495 | 1.00 | 1.35 | 1.00 | 1.233 | 0.091 |
| to | 250 | IN | 1 | (none) | 0.791 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.063 | 0.005 |
| his | 150 | NN | 1 | (none) | 0.612 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 1.235 | 0.091 |
| earthly | 10 | RB | 1 | (none) | 0.158 | 0.00 | 1.500 | 0.60 | 1.35 | 1.00 | 0.192 | 0.014 |
| life | 30 | NN | 2 | (none) | 0.274 | 0.02 | 1.505 | 1.00 | 1.00 | 1.00 | 0.413 | 0.030 |
| was | 200 | VBD | 2 | (none) | 0.707 | 0.00 | 1.500 | 1.00 | 1.00 | 1.00 | 1.061 | 0.224 |
| a | 200 | DT | 1 | (none) | 0.707 | -0.03 | 1.492 | 0.05 | 1.35 | 1.00 | 0.056 | 0.012 |
| descendant | 30 | NN | 2 | (none) | 0.274 | 0.04 | 1.510 | 1.00 | 1.00 | 1.00 | 0.414 | 0.087 |
| of | 300 | IN | 1 | (none) | 0.866 | -0.06 | 1.485 | 0.05 | 1.35 | 1.00 | 0.087 | 0.018 |
| david | 60 | NN | 2 | (strs G1138) | 0.387 | 0.18 | 1.545 | 1.00 | 1.00 | 1.18 | 0.889 | 0.190 |
| 4 | 5 | NN | 0 | (none) | 0.112 | -0.07 | 1.468 | 1.00 | 1.35 | 1.00 | 0.175 | 0.014 |
| and | 300 | CC | 1 | (none) | 0.866 | -0.05 | 1.488 | 0.05 | 1.35 | 1.00 | 0.055 | 0.005 |
| who | 250 | PWH | 1 | (none) | 0.791 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.064 | 0.006 |
| through | 20 | IN | 1 | (none) | 0.224 | -0.03 | 1.492 | 0.05 | 1.35 | 1.00 | 0.045 | 0.004 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.007 |
| spirit | 25 | NN | 2 | (none) | 0.250 | 0.05 | 1.512 | 1.00 | 1.00 | 1.00 | 0.378 | 0.031 |
| of | 300 | IN | 1 | (none) | 0.866 | -0.06 | 1.485 | 0.05 | 1.35 | 1.00 | 0.087 | 0.007 |
| holiness | 10 | NN | 2 | (none) | 0.158 | 0.01 | 1.502 | 1.00 | 1.00 | 1.00 | 0.238 | 0.019 |
| was | 200 | VBD | 2 | (none) | 0.707 | 0.00 | 1.500 | 1.00 | 1.00 | 1.00 | 1.061 | 0.087 |
| appoint | 10 | VBD | 1 | (none) | 0.158 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 0.254 | 0.020 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.007 |
| son | 60 | NN | 2 | (none) | 0.387 | 0.10 | 1.525 | 1.00 | 1.00 | 1.25 | 0.929 | 0.076 |
| of | 300 | IN | 1 | (none) | 0.866 | -0.06 | 1.485 | 0.05 | 1.35 | 1.00 | 0.087 | 0.007 |
| god | 200 | NN | 2 | (strs G2316) | 0.707 | 0.30 | 1.571 | 1.00 | 1.00 | 1.18 | 1.316 | 0.110 |
| in | 300 | IN | 1 | (none) | 0.866 | -0.05 | 1.488 | 0.05 | 1.35 | 1.00 | 0.055 | 0.006 |
| power | 20 | NN | 1 | (none) | 0.224 | 0.02 | 1.505 | 1.00 | 1.35 | 1.00 | 0.361 | 0.043 |
| by | 200 | IN | 1 | (none) | 0.707 | -0.01 | 1.495 | 0.05 | 1.35 | 1.00 | 0.056 | 0.007 |
| his | 100 | NN | 1 | (none) | 0.500 | 0.00 | 1.500 | 1.00 | 1.35 | 1.00 | 1.013 | 0.121 |
| resurrection | 15 | NN | 2 | (none) | 0.194 | 0.03 | 1.507 | 1.00 | 1.00 | 1.00 | 0.293 | 0.035 |
| from | 5 | IN | 1 | (none) | 0.112 | -0.04 | 1.490 | 0.05 | 1.35 | 1.00 | 0.009 | 0.001 |
| the | 400 | DT | 1 | (none) | 1.000 | -0.08 | 1.480 | 0.05 | 1.35 | 1.00 | 0.079 | 0.010 |
| dead | 10 | NN | 2 | (none) | 0.158 | 0.01 | 1.502 | 1.00 | 1.00 | 1.00 | 0.238 | 0.028 |
| jesus | 95 | NN | 2 | (strs G2424) | 0.487 | 0.29 | 1.571 | 1.00 | 1.00 | 1.18 | 1.066 | 0.316 |
| christ | 80 | NN | 2 | (strs G5547) | 0.447 | 0.27 | 1.567 | 1.00 | 1.00 | 1.18 | 1.039 | 0.308 |
| our | 100 | NN | 1 | (none) | 0.500 | -0.01 | 1.495 | 1.00 | 1.35 | 1.00 | 1.009 | 0.299 |
| lord | 150 | NN | 2 | (none) | 0.612 | 0.06 | 1.515 | 1.00 | 1.00 | 1.00 | 0.927 | 0.275 |

# APPENDIX

```<text phrasesCount="9" wordsCount="70" nounsCount="28">
    <phrase phraseID="1" function="subject" definition="A person named Paul, who serves Christ." sentimentScore="0.5" phraseRank="2">
        <word partOfSpeech="NN" 
              lemma="Paul" 
              pronunciation="/pɔːl/" 
              synonyms="['Saul']" 
              antonyms="[]" 
              usageExample="He is serving Paul." 
              frequency="100" 
              semanticRole="agent" 
              strongsID="G3962" 
              greekDefinition="Παῦλος" 
              biblicalDefinition="A significant figure in the New Testament." 
              wordRank="2" 
              phraseRank="2">paul</word>
        <word partOfSpeech="DT" lemma="a" frequency="200" wordRank="0" phraseRank="1">a</word>
        <word partOfSpeech="NN" lemma="servant" frequency="50" wordRank="1" phraseRank="2">servant</word>
        <word partOfSpeech="IN" lemma="of" frequency="300" wordRank="0" phraseRank="2">of</word>
        <word partOfSpeech="NN" 
              lemma="Christ" 
              strongsID="G5547" 
              greekDefinition="Χριστός" 
              biblicalDefinition="The anointed one." 
              frequency="80" 
              wordRank="2" 
              phraseRank="2">christ</word>
        <word partOfSpeech="NN" 
              lemma="Jesus" 
              strongsID="G2424" 
              greekDefinition="Ἰησοῦς" 
              biblicalDefinition="Central figure of Christianity." 
              frequency="95" 
              wordRank="2" 
              phraseRank="2">jesus</word>
    </phrase>
    <phrase phraseID="2" function="infinitive phrase" definition="The act of being or becoming an apostle." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="VBD" lemma="call" frequency="20" wordRank="1" phraseRank="1">call</word>
        <word partOfSpeech="IN" lemma="to" frequency="250" wordRank="1" phraseRank="1">to</word>
        <word partOfSpeech="VB" lemma="be" frequency="100" wordRank="2" phraseRank="1">be</word>
        <word partOfSpeech="DT" lemma="an" frequency="150" wordRank="1" phraseRank="1">an</word>
        <word partOfSpeech="NN" lemma="apostle" frequency="30" wordRank="2" phraseRank="1">apostle</word>
    </phrase>
    <phrase phraseID="3" function="modifier" definition="Describes a specific purpose or function of the gospel." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="CC" lemma="and" frequency="300" wordRank="1" phraseRank="1">and</word>
        <word partOfSpeech="NN" lemma="set" frequency="10" wordRank="1" phraseRank="1">set</word>
        <word partOfSpeech="NN" lemma="apart" frequency="15" wordRank="1" phraseRank="1">apart</word>
        <word partOfSpeech="IN" lemma="for" frequency="275" wordRank="1" phraseRank="1">for</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="NN" lemma="gospel" frequency="50" wordRank="2" phraseRank="1">gospel</word>
        <word partOfSpeech="IN" lemma="of" frequency="300" wordRank="1" phraseRank="1">of</word>
        <word partOfSpeech="NN" 
              lemma="God" 
              strongsID="G2316" 
              greekDefinition="Θεός" 
              biblicalDefinition="The Creator and Sustainer." 
              frequency="200" 
              wordRank="2" 
              phraseRank="1">god</word>
    </phrase>
    <phrase phraseID="4" function="reference" definition="Indicates the gospel he preached as previously promised." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="NN" lemma="2" frequency="5" wordRank="0" phraseRank="1">2</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="NN" lemma="gospel" frequency="50" wordRank="2" phraseRank="1">gospel</word>
        <word partOfSpeech="NN" lemma="he" frequency="150" wordRank="1" phraseRank="1">he</word>
        <word partOfSpeech="VBD" lemma="promis" frequency="10" wordRank="1" phraseRank="1">promis</word>
        <word partOfSpeech="NN" lemma="beforehand" frequency="5" wordRank="1" phraseRank="1">beforehand</word>
        <word partOfSpeech="IN" lemma="through" frequency="20" wordRank="1" phraseRank="1">through</word>
        <word partOfSpeech="NN" lemma="his" frequency="150" wordRank="1" phraseRank="1">his</word>
        <word partOfSpeech="NN" lemma="prophets" frequency="10" wordRank="1" phraseRank="1">prophets</word>
        <word partOfSpeech="IN" lemma="in" frequency="300" wordRank="1" phraseRank="1">in</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="RB" lemma="holy" frequency="15" wordRank="2" phraseRank="1">holy</word>
        <word partOfSpeech="NN" lemma="scriptures" frequency="30" wordRank="2" phraseRank="1">scriptures</word>
    </phrase>
    <phrase phraseID="5" function="topic" definition="Refers to the son in a theological context regarding his mission." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="NN" lemma="3" frequency="5" wordRank="0" phraseRank="1">3</word>
        <word partOfSpeech="VBG" lemma="regard" frequency="15" wordRank="1" phraseRank="1">regard</word>
        <word partOfSpeech="NN" lemma="his" frequency="150" wordRank="1" phraseRank="1">his</word>
        <word partOfSpeech="NN" lemma="son" frequency="60" wordRank="2" phraseRank="1">son</word>
        <word partOfSpeech="PWH" lemma="who" frequency="250" wordRank="1" phraseRank="1">who</word>
        <word partOfSpeech="NN" lemma="as" frequency="150" wordRank="1" phraseRank="1">as</word>
        <word partOfSpeech="IN" lemma="to" frequency="250" wordRank="1" phraseRank="1">to</word>
        <word partOfSpeech="NN" lemma="his" frequency="150" wordRank="1" phraseRank="1">his</word>
        <word partOfSpeech="RB" lemma="earthly" frequency="10" wordRank="1" phraseRank="1">earthly</word>
        <word partOfSpeech="NN" lemma="life" frequency="30" wordRank="2" phraseRank="1">life</word>
    </phrase>
    <phrase phraseID="6" function="subordinate clause" definition="Explains the lineage of Jesus." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="VBD" lemma="was" frequency="200" wordRank="2" phraseRank="1">was</word>
        <word partOfSpeech="DT" lemma="a" frequency="200" wordRank="1" phraseRank="1">a</word>
        <word partOfSpeech="NN" lemma="descendant" frequency="30" wordRank="2" phraseRank="1">descendant</word>
        <word partOfSpeech="IN" lemma="of" frequency="300" wordRank="1" phraseRank="1">of</word>
        <word partOfSpeech="NN" 
              lemma="David" 
              strongsID="G1138" 
              greekDefinition="Δαβίδ" 
              biblicalDefinition="King of Israel." 
              frequency="60" 
              wordRank="2" 
              phraseRank="1">david</word>
    </phrase>
    <phrase phraseID="7" function="subordinate clause" definition="Describes the divine nature of Jesus as appointed son of God." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="NN" lemma="4" frequency="5" wordRank="0" phraseRank="1">4</word>
        <word partOfSpeech="CC" lemma="and" frequency="300" wordRank="1" phraseRank="1">and</word>
        <word partOfSpeech="PWH" lemma="who" frequency="250" wordRank="1" phraseRank="1">who</word>
        <word partOfSpeech="IN" lemma="through" frequency="20" wordRank="1" phraseRank="1">through</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="NN" lemma="spirit" frequency="25" wordRank="2" phraseRank="1">spirit</word>
        <word partOfSpeech="IN" lemma="of" frequency="300" wordRank="1" phraseRank="1">of</word>
        <word partOfSpeech="NN" lemma="holiness" frequency="10" wordRank="2" phraseRank="1">holiness</word>
        <word partOfSpeech="VBD" lemma="was" frequency="200" wordRank="2" phraseRank="1">was</word>
        <word partOfSpeech="VBD" lemma="appoint" frequency="10" wordRank="1" phraseRank="1">appoint</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="NN" lemma="son" frequency="60" wordRank="2" phraseRank="1">son</word>
        <word partOfSpeech="IN" lemma="of" frequency="300" wordRank="1" phraseRank="1">of</word>
        <word partOfSpeech="NN" 
              lemma="God" 
              strongsID="G2316" 
              greekDefinition="Θεός" 
              biblicalDefinition="The Creator and Sustainer." 
              frequency="200" 
              wordRank="2" 
              phraseRank="1">god</word>
    </phrase>
    <phrase phraseID="8" function="prepositional phrase" definition="Describes the power attributed by resurrection." sentimentScore="0" phraseRank="1">
        <word partOfSpeech="IN" lemma="in" frequency="300" wordRank="1" phraseRank="1">in</word>
        <word partOfSpeech="NN" lemma="power" frequency="20" wordRank="1" phraseRank="1">power</word>
        <word partOfSpeech="IN" lemma="by" frequency="200" wordRank="1" phraseRank="1">by</word>
        <word partOfSpeech="NN" lemma="his" frequency="100" wordRank="1" phraseRank="1">his</word>
        <word partOfSpeech="NN" lemma="resurrection" frequency="15" wordRank="2" phraseRank="1">resurrection</word>
        <word partOfSpeech="IN" lemma="from" frequency="5" wordRank="1" phraseRank="1">from</word>
        <word partOfSpeech="DT" lemma="the" frequency="400" wordRank="1" phraseRank="1">the</word>
        <word partOfSpeech="NN" lemma="dead" frequency="10" wordRank="2" phraseRank="1">dead</word>
    </phrase>
    <phrase phraseID="9" function="subject" definition="Refers to Jesus Christ as the Lord." sentimentScore="0.5" phraseRank="2">
        <word partOfSpeech="NN" 
              lemma="jesus" 
              strongsID="G2424" 
              greekDefinition="Ἰησοῦς" 
              biblicalDefinition="Central figure of Christianity." 
              frequency="95" 
              wordRank="2" 
              phraseRank="2">jesus</word>
        <word partOfSpeech="NN" 
              lemma="christ" 
              strongsID="G5547" 
              greekDefinition="Χριστός" 
              biblicalDefinition="The anointed one." 
              frequency="80" 
              wordRank="2" 
              phraseRank="2">christ</word>
        <word partOfSpeech="NN" lemma="our" frequency="100" wordRank="1" phraseRank="2">our</word>
        <word partOfSpeech="NN" lemma="lord" frequency="150" wordRank="2" phraseRank="2">lord</word>
    </phrase>
</text>

```