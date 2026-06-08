const { Pool } = require('pg');

const pool = new Pool({ 
    connectionString: 'postgresql://postgres:cednHuYXQNWolJXlEvuzJkAAotGNKjEg@viaduct.proxy.rlwy.net:33638/railway',
    ssl: { rejectUnauthorized: false }
});

pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
`).then(res => {
    console.log('Tables in database:');
    res.rows.forEach(row => console.log('- ' + row.table_name));
}).catch(console.error)
  .finally(() => pool.end());
