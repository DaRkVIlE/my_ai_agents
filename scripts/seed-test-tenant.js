require('dotenv').config();
const db = require('../src/services/manager-db');

async function seed() {
  try {
    const database = await db.connect();
    
    // 1. Inserir Manager Profile
    console.log("Inserindo manager_profiles para _test-tenant...");
    await database.collection('manager_profiles').updateOne(
      { manager_id: "_test-tenant" },
      {
        $setOnInsert: {
          manager_id: "_test-tenant",
          username: "test-tenant-bot",
          business_name: "Experia Test Environment",
          test: true,
          first_access: false,
          onboarding_completed: true,
          onboarding_step: 5,
          created_at: new Date(),
          updated_at: new Date(),
          config: {
            tone: "neutro, direto",
            services: ["teste de integração", "smoke test", "E2E"],
            hours: "24/7",
            reservation_rules: null,
            examples: ["Mensagem de teste"],
            bot_status: "test"
          },
          stats: {
            messages_sent: 0,
            messages_received: 0,
            total_chats: 0,
            satisfaction_score: 0
          }
        }
      },
      { upsert: true }
    );
    console.log("✅ manager_profiles criado com sucesso!");

    // 2. Inserir Config Inicial em bot_configurations
    console.log("Inserindo bot_configurations para _test-tenant...");
    await database.collection('bot_configurations').updateOne(
      { manager_id: "_test-tenant", version: 1 },
      {
        $setOnInsert: {
          manager_id: "_test-tenant",
          version: 1,
          config: {
            channels: ["whatsapp"],
            active: false
          },
          created_at: new Date(),
          status: "active"
        }
      },
      { upsert: true }
    );
    console.log("✅ bot_configurations versão 1 criado com sucesso!");

  } catch (err) {
    console.error("❌ Erro ao realizar o seeding:", err);
  } finally {
    await db.disconnect();
    process.exit(0);
  }
}

seed();
