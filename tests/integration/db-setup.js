const { MongoMemoryServer } = require('mongodb-memory-server');
const db = require('../../src/services/manager-db');

let mongoServer;

module.exports.connect = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = 'test-db';
  
  await db.connect();
};

module.exports.closeDatabase = async () => {
  await db.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
};

module.exports.clearDatabase = async () => {
  const connection = await db.connect();
  const collections = await connection.collections();
  
  for (let collection of collections) {
    await collection.deleteMany({});
  }
};
