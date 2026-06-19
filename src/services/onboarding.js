const { getOnboardingState, setOnboardingState } = require('./redis');

async function handleOnboarding(clientId, config, remoteJid, text) {
    if (!config.onboarding) return { isComplete: true };

    const state = await getOnboardingState(clientId, remoteJid);
    const questions = config.onboarding.questions;
    
    const msgUpper = text.trim().toUpperCase();

    // START command or first interaction
    if (!state) {
        if (msgUpper === 'START' || msgUpper === 'RESETPERFIL' || msgUpper.includes('START')) {
            const newState = { step: 0, profile: {} };
            await setOnboardingState(clientId, remoteJid, newState);
            const q = questions[0];
            const opts = q.options.map((o, idx) => `${idx + 1}. ${o.label}`).join('\n');
            const msg = `${config.onboarding.welcomeMessage}\n\n${q.text}\n${opts}\n\n👉 Responda apenas com o número da opção.`;
            return { isComplete: false, replyText: msg };
        } else {
            // Not started yet
            return { isComplete: false, replyText: `Para começar a configurar seu tutor no My AIDA, digite *START*.` };
        }
    }

    if (msgUpper === 'RESETPERFIL') {
        const newState = { step: 0, profile: {} };
        await setOnboardingState(clientId, remoteJid, newState);
        const q = questions[0];
        const opts = q.options.map((o, idx) => `${idx + 1}. ${o.label}`).join('\n');
        const msg = `🔄 Perfil resetado!\n\n${q.text}\n${opts}\n\n👉 Responda apenas com o número da opção.`;
        return { isComplete: false, replyText: msg };
    }

    if (state.step >= questions.length) {
        return { isComplete: true, profile: state.profile };
    }

    // Process user answer
    const qIndex = state.step;
    const currentQ = questions[qIndex];
    
    // Validar se respondeu um número válido
    const answerNum = parseInt(text.trim(), 10);
    if (isNaN(answerNum) || answerNum < 1 || answerNum > currentQ.options.length) {
        const opts = currentQ.options.map((o, idx) => `${idx + 1}. ${o.label}`).join('\n');
        return { isComplete: false, replyText: `⚠️ Opção inválida.\n\n${currentQ.text}\n${opts}\n\n👉 Responda apenas com o número da opção.` };
    }

    // Salvar resposta no perfil
    const selectedOption = currentQ.options[answerNum - 1];
    state.profile[currentQ.id] = selectedOption.value;

    state.step += 1;
    await setOnboardingState(clientId, remoteJid, state);

    if (state.step < questions.length) {
        const nextQ = questions[state.step];
        const opts = nextQ.options.map((o, idx) => `${idx + 1}. ${o.label}`).join('\n');
        return { isComplete: false, replyText: `${nextQ.text}\n${opts}\n\n👉 Responda apenas com o número da opção.` };
    } else {
        // Concluído!
        state.completedAt = new Date().toISOString();
        await setOnboardingState(clientId, remoteJid, state);
        
        // Retornar a mensagem final de completion
        return { 
            isComplete: true, 
            justCompleted: true, 
            replyText: config.onboarding.completionMessage,
            profile: state.profile
        };
    }
}

module.exports = { handleOnboarding };
