require('dotenv').config();
const { generateResponse } = require('./src/services/groq');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./src/config/clients/paulo.json'));

async function test() {
    console.log("--- TEST ADMIN MODE ---");
    let res = await generateResponse('paulo', config, '11977701095@s.whatsapp.net', 'oi', true);
    console.log("Admin Oi:", res);

    console.log("\n--- TEST SWITCH TO CLIENT ---");
    res = await generateResponse('paulo', config, '11977701095@s.whatsapp.net', 'modo atendente', true);
    console.log("Switch:", res);

    console.log("\n--- TEST CLIENT MESSAGE 1 ---");
    res = await generateResponse('paulo', config, '11977701095@s.whatsapp.net', 'quero saber o preço', true);
    console.log("Client Msg 1:", res);

    console.log("\n--- TEST CLIENT MESSAGE 2 ---");
    res = await generateResponse('paulo', config, '11977701095@s.whatsapp.net', 'uma cadeira', true);
    console.log("Client Msg 2:", res);
}

test();
