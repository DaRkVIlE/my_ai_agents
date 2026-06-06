param(
    [string]$RailwayToken = $env:RAILWAY_TOKEN,
    [string]$TelegramToken = "",
    [string]$AdminIds = ""
)

Write-Host "🚀 Iniciando Deploy Zero-Touch do AIDA..." -ForegroundColor Cyan

# 1. Configurar Token do Railway
if (![string]::IsNullOrWhiteSpace($RailwayToken)) {
    $env:RAILWAY_TOKEN = $RailwayToken
    Write-Host "🔑 Usando Railway Token via linha de comando/ambiente." -ForegroundColor Green
}

# 2. Checar login no Railway
$status = railway status 2>&1
if ($status -match "invalid_grant" -or $status -match "Please run \`railway login\`" -or $status -match "Invalid RAILWAY_TOKEN") {
    Write-Host "⚠️ O Token atual é inválido ou você não está logado." -ForegroundColor Yellow
    Write-Host "Redirecionando para login no navegador..." -ForegroundColor Cyan
    railway login
}

# 3. Conectar ao projeto correto
Write-Host "`n🔗 Selecione o projeto do AIDA na lista abaixo:" -ForegroundColor Cyan
railway link

# 4. Coletar Tokens se não foram passados
if ([string]::IsNullOrWhiteSpace($TelegramToken)) {
    $TelegramToken = Read-Host "🤖 Cole o HTTP Token do @BotFather (AIDA_TELEGRAM_TOKEN)"
}
if ([string]::IsNullOrWhiteSpace($AdminIds)) {
    $AdminIds = Read-Host "👤 Cole o seu ID do Telegram (AIDA_ADMIN_IDS)"
}

# 5. Injetar variáveis de produção no Railway
Write-Host "`n⚙️ Injetando Variáveis de Ambiente no Railway..." -ForegroundColor Cyan
railway vars set AIDA_TELEGRAM_TOKEN=$TelegramToken
railway vars set AIDA_ADMIN_IDS=$AdminIds
railway vars set NODE_ENV="production"
railway vars set PORT="8080"

# O banco de dados PostgreSQL nós adicionamos com 1 comando
Write-Host "`n🗄️ Verificando Banco de Dados PostgreSQL..." -ForegroundColor Cyan
railway add -p postgresql

# 6. Deploy Final
Write-Host "`n🚀 Subindo o código para produção..." -ForegroundColor Green
railway up

Write-Host "`n✅ DEPLOY CONCLUÍDO!" -ForegroundColor Green
Write-Host "O AIDA já deve estar rodando e conectado ao seu banco e ao Telegram."
