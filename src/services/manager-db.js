/**
 * Manager Database Service (MongoDB Atlas)
 * 
 * Handles all database operations for manager profiles, onboarding,
 * and bot configurations.
 */

const { MongoClient } = require('mongodb');

let mongoClient = null;
let db = null;

/**
 * Initialize MongoDB connection
 */
async function connect() {
  if (db) return db;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI não configurado nas variáveis de ambiente');
  }

  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    await mongoClient.connect();
    db = mongoClient.db(process.env.MONGODB_DB || 'commercial-ai-bots');

    // Criar índices
    await createIndexes();

    console.log('[MongoDB] ✅ Conectado com sucesso ao MongoDB Atlas');
    return db;
  } catch (err) {
    console.error('[MongoDB] ❌ Erro ao conectar:', err.message);
    throw err;
  }
}

/**
 * Create necessary indexes
 */
async function createIndexes() {
  try {
    const managersCollection = db.collection('manager_profiles');
    await managersCollection.createIndex({ manager_id: 1 }, { unique: true });
    await managersCollection.createIndex({ username: 1 }, { unique: true });
    await managersCollection.createIndex({ created_at: 1 });
    await managersCollection.createIndex({ first_access: 1 });

    const configsCollection = db.collection('bot_configurations');
    await configsCollection.createIndex({ manager_id: 1 });
    await configsCollection.createIndex({ updated_at: -1 });

    const onboardingCollection = db.collection('onboarding_sessions');
    await onboardingCollection.createIndex({ manager_id: 1 });
    await onboardingCollection.createIndex({ started_at: 1 });

    console.log('[MongoDB] 📋 Índices criados/validados');
  } catch (err) {
    console.warn('[MongoDB] ⚠️ Erro ao criar índices:', err.message);
  }
}

/**
 * Get or create manager profile
 */
async function getOrCreateManager(managerId, username, businessName = '') {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  let manager = await collection.findOne({ manager_id: managerId });

  if (!manager) {
    const newManager = {
      manager_id: managerId,
      username,
      business_name: businessName,
      first_access: true,
      onboarding_completed: false,
      onboarding_step: 0,
      created_at: new Date(),
      updated_at: new Date(),
      config: {
        tone: null,
        services: [],
        hours: null,
        reservation_rules: null,
        examples: [],
        bot_status: 'inactive'
      },
      stats: {
        messages_sent: 0,
        messages_received: 0,
        total_chats: 0,
        satisfaction_score: 0
      }
    };

    await collection.insertOne(newManager);
    manager = newManager;
  }

  return manager;
}

/**
 * Update manager profile
 */
async function updateManager(managerId, updates) {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  const result = await collection.updateOne(
    { manager_id: managerId },
    {
      $set: {
        ...updates,
        updated_at: new Date()
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Mark first access as complete
 */
async function completeFirstAccess(managerId) {
  return updateManager(managerId, {
    first_access: false,
    first_access_date: new Date()
  });
}

/**
 * Update onboarding step
 */
async function updateOnboardingStep(managerId, step, responses) {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  const result = await collection.updateOne(
    { manager_id: managerId },
    {
      $set: {
        onboarding_step: step,
        onboarding_responses: {
          ...responses,
          updated_at: new Date()
        }
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Complete onboarding
 */
async function completeOnboarding(managerId, finalConfig) {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  const result = await collection.updateOne(
    { manager_id: managerId },
    {
      $set: {
        onboarding_completed: true,
        onboarding_completed_at: new Date(),
        config: {
          ...finalConfig,
          bot_status: 'inactive' // Começa inativo até gestor ativar
        }
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Get manager configuration
 */
async function getManagerConfig(managerId) {
  const db = await connect();
  const manager = await db.collection('manager_profiles').findOne({ manager_id: managerId });

  return manager?.config || null;
}

/**
 * Update manager configuration
 */
async function updateManagerConfig(managerId, configUpdates) {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  const result = await collection.updateOne(
    { manager_id: managerId },
    {
      $set: {
        config: configUpdates,
        updated_at: new Date()
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Save bot configuration version
 */
async function saveBotConfigVersion(managerId, config, version = 1) {
  const db = await connect();
  const collection = db.collection('bot_configurations');

  const configVersion = {
    manager_id: managerId,
    version,
    config,
    created_at: new Date(),
    status: 'active'
  };

  // Mark previous versions as inactive
  await collection.updateMany(
    { manager_id: managerId },
    { $set: { status: 'archived' } }
  );

  // Insert new version
  const result = await collection.insertOne(configVersion);

  return result.insertedId;
}

/**
 * Get bot configuration history
 */
async function getConfigHistory(managerId, limit = 10) {
  const db = await connect();
  const collection = db.collection('bot_configurations');

  const history = await collection
    .find({ manager_id: managerId })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  return history;
}

/**
 * Save onboarding session
 */
async function saveOnboardingSession(managerId, sessionData) {
  const db = await connect();
  const collection = db.collection('onboarding_sessions');

  const session = {
    manager_id: managerId,
    ...sessionData,
    started_at: new Date(),
    updated_at: new Date()
  };

  const result = await collection.insertOne(session);
  return result.insertedId;
}

/**
 * Get onboarding session
 */
async function getOnboardingSession(managerId) {
  const db = await connect();
  const collection = db.collection('onboarding_sessions');

  const session = await collection.findOne(
    { manager_id: managerId },
    { sort: { started_at: -1 } }
  );

  return session;
}

/**
 * Log manager action (audit trail)
 */
async function logManagerAction(managerId, action, details = {}) {
  const db = await connect();
  const collection = db.collection('manager_audit_log');

  const log = {
    manager_id: managerId,
    action,
    details,
    timestamp: new Date()
  };

  await collection.insertOne(log);
}

/**
 * Get manager audit log
 */
async function getManagerAuditLog(managerId, limit = 50) {
  const db = await connect();
  const collection = db.collection('manager_audit_log');

  const logs = await collection
    .find({ manager_id: managerId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return logs;
}

/**
 * Update manager statistics
 */
async function updateManagerStats(managerId, stats) {
  const db = await connect();
  const collection = db.collection('manager_profiles');

  const result = await collection.updateOne(
    { manager_id: managerId },
    {
      $set: {
        stats: {
          ...stats,
          updated_at: new Date()
        }
      }
    }
  );

  return result.modifiedCount > 0;
}

/**
 * Get manager statistics
 */
async function getManagerStats(managerId) {
  const db = await connect();
  const manager = await db.collection('manager_profiles').findOne({ manager_id: managerId });

  return manager?.stats || null;
}

/**
 * List all active managers
 */
async function listActiveManagers(limit = 100) {
  const db = await connect();
  const managers = await db
    .collection('manager_profiles')
    .find({ onboarding_completed: true })
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray();

  return managers;
}

/**
 * List managers by status
 */
async function getManagersByStatus(status, limit = 100) {
  const db = await connect();
  const managers = await db
    .collection('manager_profiles')
    .find({ 'config.bot_status': status })
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray();

  return managers;
}

/**
 * Health check
 */
async function healthCheck() {
  try {
    const db = await connect();
    await db.admin().ping();
    return { ok: true, message: 'MongoDB Atlas conectado' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Graceful disconnect
 */
async function disconnect() {
  if (mongoClient) {
    await mongoClient.close();
    db = null;
    mongoClient = null;
    console.log('[MongoDB] Desconectado');
  }
}

module.exports = {
  connect,
  getOrCreateManager,
  updateManager,
  completeFirstAccess,
  updateOnboardingStep,
  completeOnboarding,
  getManagerConfig,
  updateManagerConfig,
  saveBotConfigVersion,
  getConfigHistory,
  saveOnboardingSession,
  getOnboardingSession,
  logManagerAction,
  getManagerAuditLog,
  updateManagerStats,
  getManagerStats,
  listActiveManagers,
  getManagersByStatus,
  healthCheck,
  disconnect
};
