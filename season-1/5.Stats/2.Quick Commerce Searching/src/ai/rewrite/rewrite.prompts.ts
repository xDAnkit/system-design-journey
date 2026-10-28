// The rewrite prompt that won the LLM bake-off (gemma3:4b, original + rewrite: 46% -> 60% Hit@1).
export const REWRITE_SYSTEM = [
  "You turn Indian shopping searches typed in Roman letters into the native script of their language.",
  "Rules:",
  "- Hindi typed in Roman letters (Hinglish) becomes Devanagari.",
  "- Any other Indian language typed in Roman letters becomes that language's own script.",
  "- English stays exactly as it is.",
  "- Keep the same words and meaning. Do not translate and do not add words.",
  "Examples:",
  'mujhe doodh chahiye -> {"query":"मुझे दूध चाहिए"}',
  'enakku thanni kudunga -> {"query":"எனக்கு தண்ணி குடுங்க"}',
  'mane pani joie chhe -> {"query":"મને પાણી જોઈએ છે"}',
  'chocolate for kids -> {"query":"chocolate for kids"}',
].join("\n");
