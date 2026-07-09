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
    }

    // ── BRIEFING DO MÉTODO (Story 1.4 - A Escadinha) ────────────────────────
    // Nível <= 3 passa por uma explicação do método antes da primeira cena.
    const nivel = parseInt(state.profile.nivel, 10) || 3;
    
    if (nivel <= 3 && !state.briefingCompleted) {
        if (state.briefingStep === undefined) {
            state.briefingStep = 0;
            await setOnboardingState(clientId, remoteJid, state);
            return {
                isComplete: false,
                replyText: `🏊‍♂️ *Você está prestes a entrar na piscina!*\n\nMas calma, não vamos te jogar no fundo.\nO My AIDA usa a metodologia de "Imersão Gradual". Você não vai *estudar* inglês. Você vai *viver* em inglês. Só que de pouquinho. 😉\n\n👉 Digite *1* para continuar.`
            };
        }

        if (state.briefingStep === 0) {
            if (text.trim() !== '1') return { isComplete: false, replyText: `👉 Digite *1* para continuar.` };
            state.briefingStep = 1;
            await setOnboardingState(clientId, remoteJid, state);
            return {
                isComplete: false,
                replyText: `🧩 *O que é um Gap?*\n\nNas nossas conversas, você vai encontrar palavras que não entende. Isso é um *Gap*.\nEm vez de travar, tente entender o contexto. Vou traduzir apenas as *palavras-chave* (Traducão Parcial) para te ajudar a fluir.\n\n👉 Digite *1* para continuar.`
            };
        }

        if (state.briefingStep === 1) {
            if (text.trim() !== '1') return { isComplete: false, replyText: `👉 Digite *1* para continuar.` };
            state.briefingStep = 2;
            await setOnboardingState(clientId, remoteJid, state);
            return {
                isComplete: false,
                replyText: `🗣️ *O Output Sem Medo*\n\nSua única regra: *sempre responda em inglês!* Mesmo que saia errado.\nEu *nunca* vou dar aula de gramática chata ou dizer "tá errado". Vou continuar o papo usando a forma certa para você pegar o jeito naturalmente.\n\n👉 Digite *1* para continuar.`
            };
        }

        if (state.briefingStep === 2) {
            if (text.trim() !== '1') return { isComplete: false, replyText: `👉 Digite *1* para continuar.` };
            state.briefingStep = 3;
            await setOnboardingState(clientId, remoteJid, state);
            return {
                isComplete: false,
                replyText: `🚀 *Tudo pronto?*\n\nTopa entrar na piscina agora e receber a sua primeira cena?\n\n👉 Responda: *SIM* ou *AINDA NÃO*`
            };
        }

        if (state.briefingStep === 3) {
            const resp = text.trim().toUpperCase();
            if (resp === 'SIM') {
                state.briefingCompleted = true;
                state.completedAt = new Date().toISOString();
                await setOnboardingState(clientId, remoteJid, state);
                return { 
                    isComplete: true, 
                    justCompleted: true, 
                    replyText: config.onboarding.completionMessage,
                    profile: state.profile
                };
            } else if (resp === 'AINDA NÃO' || resp === 'AINDA NAO') {
                return {
                    isComplete: false,
                    replyText: `Sem problemas! O segredo é ir no seu tempo. 🐢\n\nAqui, o foco é você se sentir confortável. Quando estiver pronto para começar de verdade, basta digitar *SIM*.`
                };
            } else {
                return {
                    isComplete: false,
                    replyText: `👉 Responda: *SIM* (para começar) ou *AINDA NÃO* (se quiser esperar).`
                };
            }
        }
    }

    // ── FIM DO ONBOARDING (Nível > 3 ou Briefing Concluído) ─────────────────
    if (!state.completedAt) {
        state.completedAt = new Date().toISOString();
        state.briefingCompleted = true; // Para garantir
        await setOnboardingState(clientId, remoteJid, state);
        
        return { 
            isComplete: true, 
            justCompleted: true, 
            replyText: config.onboarding.completionMessage,
            profile: state.profile
        };
    }

    return { isComplete: true, profile: state.profile };
}

module.exports = { handleOnboarding };
