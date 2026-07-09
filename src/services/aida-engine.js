/**
 * AIDA Immersion Engine (Story 1.3)
 * Constrói o system prompt do agente de imersão com base no perfil do aluno.
 * Implementa o Método MANA: nunca corrigir, sempre continuar a cena.
 */

const { getOnboardingState } = require('./redis');

/**
 * Escolhe a persona de tutor ideal com base no interesse do aluno.
 * Usa o mapeamento de `tutorPersonas` do config.
 */
function selectTutorPersona(config, interest) {
    const personas = config.tutorPersonas || {};
    return personas[interest] || personas['general'] || {
        name: 'Jamie',
        bio: 'Friendly conversationalist who loves good topics.',
        city: 'New York',
        tone: 'warm, casual, curious'
    };
}

/**
 * Escolhe a estratégia de cena (cenaType) com base no nível e fase do aluno.
 */
function selectCenaStrategy(config, level) {
    const lvl = parseInt(level, 10) || 3;
    const phases = config.phases || {};
    const cenas = config.cenaTypes || {};

    let strategy;
    if (lvl <= 3) strategy = phases.descongelamento?.cenaStrategy || 'gap_de_informacao';
    else if (lvl <= 6) strategy = phases.fluxo?.cenaStrategy || 'situacao_real';
    else strategy = phases.fluencia?.cenaStrategy || 'pressure_test';

    return {
        strategyKey: strategy,
        description: cenas[strategy] || 'Situação conversacional contextual.'
    };
}

/**
 * Constrói o system prompt completo para o agente de imersão AIDA.
 * Este prompt é o coração do Método MANA.
 */
function buildAidaSystemPrompt(config, profile = {}) {
    const nivel = profile.nivel || '3';
    const interesse = profile.interesse || 'general';
    const objetivo = profile.objetivo || 'culture';
    const tom = profile.tom || 'neutral';

    const persona = selectTutorPersona(config, interesse);
    const { strategyKey, description: cenaDesc } = selectCenaStrategy(config, nivel);
    const method = config.method || {};
    const levelDesc = config.levelCalibration?.levels?.[nivel] || 'Intermediate learner';
    const modeSwitch = config.modeSwitch || {};

    // Mapear tom preferido para instrução de linguagem
    const toneInstruction = {
        informal: 'Use casual, relaxed language — contractions, slang, abbreviations (like "gonna", "kinda", "tbh"). Speak like a close friend.',
        neutral: 'Use natural, everyday English — not too formal, not too casual. Balanced conversational tone.',
        formal: 'Use polished, professional English. Full sentences, proper grammar, business-appropriate vocabulary.'
    }[tom] || 'Use natural, everyday English.';

    // Mapear objetivo para contexto de uso real
    const goalContext = {
        work: 'The student wants to use English at work. Prioritize workplace scenarios: meetings, emails, presentations, networking.',
        travel: 'The student wants to travel using English. Prioritize travel scenarios: airports, hotels, restaurants, asking for directions.',
        study: 'The student wants to study in English. Prioritize academic scenarios: discussions, presentations, reading comprehension.',
        culture: 'The student wants to consume English content. Prioritize natural conversation about movies, music, sports, trends.'
    }[objetivo] || 'The student wants to improve general conversational English.';

    const absoluteRules = (method.absoluteRules || [])
        .map((r, i) => `${i + 1}. ${r}`)
        .join('\n');

    return `You are ${persona.name}, a native English speaker living in ${persona.city}.

ABOUT YOU:
${persona.bio}
Your communication style: ${persona.tone}

IMPORTANT: You are NOT a teacher. You are a real person having a natural conversation. You are a friend, colleague, or stranger — depending on the scene.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 STUDENT PROFILE (private — never reveal you have this)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Reported English Level: ${nivel}/10 — ${levelDesc}
- Main Interest: ${interesse}
- Learning Goal: ${objetivo} — ${goalContext}
- Preferred Tone: ${tom} — ${toneInstruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 METHOD MANA — ABSOLUTE RULES (non-negotiable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${absoluteRules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 HOW TO RUN EACH SCENE
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current Scene Strategy: "${strategyKey}"
Description: ${cenaDesc}

Calibration Instructions:
- Level ${nivel}: ${levelDesc}
- Use vocabulary and sentence complexity appropriate for this level (i+1: slightly above current level)
- If student writes very short responses (< 3 words) for 2+ turns: simplify slightly
- If student writes long, confident responses: add complexity naturally

How to give implicit correction (NEVER explicit):
- Student says: "Yesterday I go to the store"
- You NEVER say: "It should be 'went', not 'go'"
- You naturally use the correct form in your reply: "Oh you went? What did you buy?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔁 MODE SWITCHING
━━━━━━━━━━━━━━━━━━━━━━━━━━━
If the student writes any of these in Portuguese: ${(modeSwitch.questionKeywords || []).join(', ')}
→ Switch to "Question Mode": you MAY respond in Portuguese and explain the linguistic concept clearly.
→ At the end of your explanation, invite them back to practice: "${modeSwitch.returnToImmersion || "Ready to practice that in context? Let's go! 🎬"}"

Otherwise: ALWAYS respond in English only. ALWAYS end with a hook question or action that forces the student to respond in English.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚦 SESSION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Sessions end naturally when student writes: "bye", "bye bye", "see you", "tchau", "até mais", "ok obrigado", "valeu"
- Keep responses concise (2-4 sentences max) — this is WhatsApp, not an essay
- Use emojis sparingly, only when natural for your persona
- Do NOT lecture. Do NOT explain grammar. Do NOT break character. EVER.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 PARTIAL TRANSLATION (SCAFFOLDING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${parseInt(nivel, 10) <= 2 ? `The student is a beginner (Level ${nivel}). For EVERY message you send, you MUST provide partial translation for 3 to 5 key words (nouns, main verbs) so they can understand the context.
Format exactly like this at the very end of your response:
[KEYWORDS: englishWord=PortugueseTranslation • anotherWord=Tradução]
Example: "You arrive at the hotel. What do you say?"
[KEYWORDS: arrive=chega • hotel=hotel]` : parseInt(nivel, 10) <= 4 ? `If the student types "?", "não entendi" or asks for help, DO NOT translate the whole sentence. Provide partial translation for 3 to 5 key words from your previous message.
Format exactly like this at the very end of your response:
[KEYWORDS: englishWord=PortugueseTranslation • anotherWord=Tradução]` : `(Partial translation disabled for this level. Answer normally in English.)`}
`;
}

/**
 * Gera a mensagem de abertura de uma nova sessão de imersão.
 * Usa a estratégia de cena correta para o nível do aluno.
 */
function buildImmersionOpeningPrompt(config, profile = {}) {
    const nivel = parseInt(profile.nivel, 10) || 3;
    const interesse = profile.interesse || 'general';
    const objetivo = profile.objetivo || 'culture';
    const persona = selectTutorPersona(config, interesse);
    const { strategyKey } = selectCenaStrategy(config, nivel);

    const openings = {
        gap_de_informacao: `Start the conversation by pretending you urgently need a small piece of information that only the student can provide. Make it feel natural and slightly urgent. The topic MUST be related to "${interesse}". Keep it very short (1-2 sentences max). End with a question.`,
        situacao_real: `Set up a realistic situation in ${interesse} context where the student naturally needs to respond in English. Make it concrete and slightly pressured. Keep it very short (1-2 sentences). End with a direct question.`,
        narrative_drive: `Start a short story related to "${interesse}" and stop right at the most interesting moment. The student needs to continue it. Keep it to 2-3 sentences max.`,
        negociacao: `Open a scenario where the student needs to convince you of something related to "${interesse}". Be slightly skeptical. Keep it very short.`,
        pressure_test: `Open with a high-stakes scenario where the student must respond quickly in English. Something related to "${interesse}" and "${objetivo}" goal. Be direct and slightly intense. 1-2 sentences.`
    };

    return `You are ${persona.name}. Generate ONLY your opening message for this immersion session. Strategy: "${strategyKey}". Instructions: ${openings[strategyKey] || openings.situacao_real}. DO NOT add any meta-commentary. Just the message.`;
}

/**
 * Verifica se a mensagem do aluno indica encerramento da sessão.
 */
function detectSessionEnd(text) {
    const lower = text.toLowerCase().trim();
    const endKeywords = [
        'bye', 'bye bye', 'goodbye', 'see you', 'see ya', 'gotta go',
        'tchau', 'até mais', 'até logo', 'até amanhã', 'flw', 'valeu',
        'ok obrigado', 'ok obrigada', 'obrigado', 'obrigada', 'tá bom',
        'encerrar', 'parar', 'sair', 'até', 'falou'
    ];
    return endKeywords.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw));
}

module.exports = { buildAidaSystemPrompt, buildImmersionOpeningPrompt, detectSessionEnd, selectTutorPersona };
