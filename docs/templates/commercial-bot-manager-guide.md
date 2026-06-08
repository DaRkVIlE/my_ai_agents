# 🤖 Guia Completo de Utilização do Bot de Atendimento com IA

> **Para quem é este guia?**
> Para **donos de negócio** e **gestores** que querem extrair o máximo de valor do seu assistente virtual inteligente. Aqui você vai aprender tudo — desde como o cliente deve conversar, até como você controla o bot em tempo real.

---

## 📋 Índice Rápido

1. [O que esse bot consegue fazer?](#1-o-que-esse-bot-consegue-fazer)
2. [Como o cliente deve conversar](#2-como-o-cliente-deve-conversar)
3. [Áudios — O bot ouve e responde](#3-áudios--o-bot-ouve-e-responde)
4. [Fotos e Imagens — O bot enxerga](#4-fotos-e-imagens--o-bot-enxerga)
5. [Seu Painel Secreto de Controle](#5-seu-painel-secreto-de-controle)
6. [Regras Dinâmicas — Altere o bot na hora](#6-regras-dinâmicas--altere-o-bot-na-hora)
7. [Pausando e Retomando o Atendimento](#7-pausando-e-retomando-o-atendimento)
8. [Testando como um Cliente](#8-testando-como-um-cliente)
9. [Boas Práticas para o Gestor](#9-boas-práticas-para-o-gestor)
10. [O que NÃO fazer](#10-o-que-não-fazer)

---

## 1. O que esse bot consegue fazer?

Esqueça os menus de "Digite 1 para Vendas". Seu bot é um **atendente inteligente** que:

| Capacidade | O que significa na prática |
|---|---|
| 🧠 **Entende contexto** | Se o cliente escrever errado ou mudar de assunto, o bot acompanha |
| 🎤 **Ouve áudios** | Transcreve e responde mensagens de voz automaticamente |
| 📸 **Enxerga imagens** | Analisa fotos enviadas pelo cliente e responde com contexto |
| 🗂️ **Faz triagem** | Coleta as informações certas antes de encaminhar para você |
| 🕐 **Trabalha 24/7** | Responde às 2h da manhã, no feriado, durante o almoço |
| 🧑‍💼 **Age como vendedor** | Guia o cliente naturalmente até o fechamento ou agendamento |

---

## 2. Como o cliente deve conversar

O bot foi treinado para **atender como um humano**, então o cliente pode escrever do jeito que normalmente escreveria para um atendente.

### ✅ O que funciona muito bem:
- Mensagens normais, do jeito que a pessoa fala
- Erros de digitação (o bot entende)
- Perguntas abertas ("o que vocês fazem?", "qual o preço?")
- Múltiplas perguntas na mesma mensagem
- Emojis, abreviações, linguagem casual

### 💬 Exemplos reais:
```
"oi, meu iphone11 caiu e a tela ficou reta preta, vcs consertam?"
→ Bot entende: iPhone 11 + tela quebrada + interesse em conserto

"preciso de um jardim na entrada de casa, tenho mais ou menos 3m²"
→ Bot entende: pedido de orçamento + metragem já informada

"q horas fecha?"
→ Bot responde com os horários direto, sem cerimônia
```

### ⚠️ Dica importante para ensinar seus clientes:
> Sempre que for enviar **foto**, pedir para a pessoa colocar também **uma legenda** explicando o que quer. (Veja mais na seção 4)

---

## 3. Áudios — O bot ouve e responde

Seu bot possui **transcrição automática de áudio**. O cliente não precisa digitar nada se não quiser.

### Como funciona:
1. Cliente manda um áudio no WhatsApp
2. O bot transcreve o áudio em segundos
3. Responde ao conteúdo do áudio como se fosse texto

### Casos de uso práticos:
- Cliente descreve o problema do aparelho por voz → bot entende e faz a triagem
- Cliente pede informação rápida enquanto dirige → bot atende
- Pessoa idosa que prefere falar → totalmente suportado

### 🎤 Você também pode usar áudio como gestor:
Você pode mandar áudios para o seu próprio bot para inserir **regras dinâmicas** (veja seção 6) mais rapidamente, sem precisar digitar tudo.

---

## 4. Fotos e Imagens — O bot enxerga

O bot possui **visão computacional com IA**. Ele consegue olhar uma foto e entender o que está vendo.

### O segredo para funcionar perfeitamente:

> **⚠️ REGRA DE OURO:** A foto SEMPRE deve vir acompanhada de uma **legenda** (o texto que aparece junto com a imagem no WhatsApp).

**Por quê?** O motor de visão usa o texto da legenda como "foco". Sem legenda, a IA vê a foto mas não sabe o que você quer dela.

### Exemplos práticos:

| Situação | ❌ Jeito errado | ✅ Jeito certo |
|---|---|---|
| Tela quebrada | Manda só a foto | Foto + "minha tela está assim, tem conserto?" |
| Peça de roupa | Manda só a foto | Foto + "quero um vestido parecido com esse, vocês fazem?" |
| Produto do cardápio | Manda só a foto | Foto + "esse prato ainda tem hoje?" |
| Planta do ambiente | Manda só a foto | Foto + "esse espaço tem 4m², quero um jardim" |

### 📲 Como ensinar seus clientes:
Você pode salvar essa mensagem como resposta rápida no seu próprio WhatsApp e compartilhar quando necessário:
> *"Para eu conseguir te ajudar melhor com a foto, me manda ela com uma descrição do que você precisa, tá? Ex: 'Minha tela está assim, vocês consertam?'"*

---

## 5. Seu Painel Secreto de Controle

Como gestor, **seu número está cadastrado como administrador**. Isso significa que o bot te trata de forma diferente dos clientes.

### Acesso ao modo admin:
Basta mandar qualquer mensagem normalmente para o número do bot. Ele vai reconhecer que é você e ativar recursos exclusivos.

### Comandos disponíveis para você:

| Comando | O que faz |
|---|---|
| `!regra [texto]` | Injeta uma nova instrução no bot em tempo real |
| `!regras` | Lista todas as regras dinâmicas ativas |
| `!remover [número]` | Remove uma regra específica da lista |
| `!limpar` | Remove TODAS as regras dinâmicas |
| `desligar bot` | Pausa o bot para todos os clientes |
| `ligar bot` | Reativa o bot |
| `modo cliente` | Você passa a ser atendido como cliente (para testes) |
| `modo admin` | Volta ao modo de gestor |

---

## 6. Regras Dinâmicas — Altere o bot na hora

Esta é uma das funcionalidades mais poderosas. Você pode **mudar o comportamento do bot em segundos**, sem precisar chamar o suporte técnico.

### Como usar:
```
!regra [o que você quer que o bot faça ou informe]
```

### 📌 Exemplos reais de uso:

**Aviso de fechamento antecipado:**
```
!regra A loja vai fechar às 14h hoje por causa de um evento. Informe isso aos clientes que perguntarem sobre horário.
```

**Promoção do dia:**
```
!regra Temos uma promoção especial hoje: 15% de desconto em troca de tela para iPhone. Mencione isso sempre que o cliente perguntar sobre preço.
```

**Produto em falta:**
```
!regra O modelo Galaxy A54 não tem tela disponível em estoque hoje. Se o cliente perguntar, diga que estamos aguardando reposição.
```

**Informação temporária:**
```
!regra Estamos sem internet no momento. Se o cliente precisar de atendimento urgente, peça para ligar no (11) 99999-9999.
```

### Gerenciando as regras:

```
!regras
→ Bot retorna a lista numerada com todas as regras ativas

!remover 2
→ Remove a regra número 2 da lista

!limpar
→ Remove todas as regras, voltando ao padrão
```

---

## 7. Pausando e Retomando o Atendimento

Às vezes você precisa atender um cliente pessoalmente, ou a loja vai fechar. Você tem controle total sobre isso.

### Pausar o bot globalmente:
```
desligar bot
```
O bot para de responder **todos** os clientes até você reativar.

### Reativar o bot:
```
ligar bot
```
O bot volta ao funcionamento normal.

### ⚡ Quando usar cada um:

| Situação | Ação recomendada |
|---|---|
| Você quer atender um cliente pessoalmente | Responda direto pelo WhatsApp Web |
| Vai sair para almoço e quer revisar antes | `desligar bot` → revisa → `ligar bot` |
| Manutenção ou atualização do sistema | `desligar bot` |
| Feriado com atendimento especial | `!regra Hoje atendemos só até as 12h` |

---

## 8. Testando como um Cliente

Antes de divulgar o número para seus clientes, **sempre teste primeiro**. O modo cliente permite isso.

### Como ativar o modo de teste:
```
modo cliente
```
A partir daí, o bot vai te atender exatamente como atenderia qualquer cliente. Teste as perguntas mais comuns, veja se as respostas fazem sentido.

### Como voltar ao modo normal:
```
modo admin
```

### 🧪 Checklist de teste recomendado:
- [ ] Pergunta sobre horário de funcionamento
- [ ] Pergunta sobre preço de um serviço
- [ ] Mensagem confusa ou com erro de digitação
- [ ] Envio de áudio descrevendo um problema
- [ ] Envio de foto com legenda
- [ ] Pergunta que o bot não sabe responder (como ele se comporta?)
- [ ] Pedido de orçamento completo

---

## 9. Boas Práticas para o Gestor

### 🌅 Rotina diária recomendada:

**Ao chegar na loja:**
1. Mande um "oi" pro bot para confirmar que está online
2. Se tiver alguma novidade do dia, use `!regra` para informar o bot

**Durante o dia:**
3. Quando um cliente "quente" aparecer no WhatsApp, assuma o atendimento manualmente
4. Se precisar sair, coloque uma `!regra` com o aviso

**Ao fechar:**
5. Coloque uma `!regra` informando que estão fechados (opcional)
6. O bot continua atendendo normalmente fora do horário, isso é o diferencial!

---

### 💡 Dicas de ouro para melhores resultados:

**1. Ensine o bot sobre novidades constantemente**
Use `!regra` sempre que tiver algo novo: promoção, produto novo, mudança de horário. Quanto mais informado o bot, melhor ele atende.

**2. Compartilhe o número ativamente**
O bot só gera valor se os clientes usarem. Coloque o número na bio do Instagram, no cardápio (se aplicável), nos materiais de divulgação.

**3. Revise os atendimentos periodicamente**
Peça ao seu suporte técnico acesso ao painel de conversas para identificar onde o bot está errando ou onde os clientes ficam com dúvida.

**4. Use o bot como seu assistente pessoal também**
No modo admin, você pode pedir para o bot te ajudar a redigir mensagens para clientes, calcular orçamentos ou organizar informações.

---

## 10. O que NÃO fazer

| ❌ Erro comum | Por quê é problema | ✅ Como evitar |
|---|---|---|
| Enviar foto sem legenda | O bot não sabe o que você quer da foto | Sempre adicionar legenda descritiva |
| Deixar de testar antes de divulgar | Clientes encontrarão falhas antes de você | Fazer checklist de teste completo |
| Nunca usar `!regra` | O bot fica desatualizado com a operação | Usar a cada novidade relevante |
| Responder clientes sem avisar o bot | Confusão — bot e humano respondendo juntos | Usar `desligar bot` quando for atender manualmente |
| Esperar que o bot feche vendas sozinho | Ele prepara o terreno, o fechamento é seu | Assumir quando o cliente estiver "quente" |

---

## 🚀 Resumo dos Comandos

```
📌 REGRAS DINÂMICAS
!regra [texto]     → Adiciona instrução em tempo real
!regras            → Lista todas as regras ativas
!remover [nº]      → Remove regra específica
!limpar            → Remove todas as regras

🔄 CONTROLE DO BOT
desligar bot       → Pausa todos os atendimentos
ligar bot          → Reativa todos os atendimentos

🎭 PERSONAS DE TESTE
modo cliente       → Você é atendido como cliente
modo admin         → Volta ao modo gestor
```

---

> 💬 **Dúvidas ou problemas?** Entre em contato com o suporte técnico.
> O bot não substitui você — ele trabalha **para** você, 24 horas por dia, 7 dias por semana.
