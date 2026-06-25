# 🤖 Discord Bot - Lan-Play Server Monitor

Um bot Discord avançado que monitora e exibe servidores Lan-Play ativos em tempo real, fornecendo informações como IP, latência, uptime e país de origem de cada servidor.

## ✨ Funcionalidades Principais

### 📌 Comandos Disponíveis

- **`/servidores`** - Exibe todos os servidores Lan-Play ativos com informações detalhadas:
  - 🌍 Bandeira do país
  - 🔌 Endereço de conexão
  - 📍 IPv4
  - ⚡ Latência (ping)
  - ⏱️ Uptime (% de tempo online)

- **`🔄 /atualizar`** - Força a atualização do cache dos servidores para obter dados frescos

- **`❓ /helper`** - Exibe menu de ajuda com todos os comandos e funcionalidades

### 🧹 Recursos Automáticos

- **Limpeza de mensagens** - Remove automaticamente mensagens fora de contexto
- **Cache inteligente** - Dados cacheados por 5 minutos para respostas rápidas
- **Detecção de contexto** - Avisa usuários sobre mensagens inadequadas com o menu de ajuda
- **Tratamento de erros** - Fallback para dados cacheados em caso de falha na API

## 🚀 Como Começar

### Pré-requisitos

- Node.js 18+ instalado
- npm ou yarn
- Um servidor Discord com permissões de bot
- Token do Discord Bot (obtido em [Discord Developer Portal](https://discord.com/developers))
- Chave da API UptimeRobot

### Instalação

1. Clone o repositório:
```bash
git clone https://github.com/zeidlerneto1/Bot-Discord-Switch-Lan-PLay.git
cd Bot-Discord-Switch-Lan-PLay
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

4. Preencha o arquivo `.env` com suas credenciais:
```env
DISCORD_TOKEN=seu_token_do_bot
UPTIMEROBOT_KEY=sua_chave_da_api_uptimerobot
```

### Desenvolvimento

Para rodar em modo desenvolvimento com hot-reload:
```bash
npm run dev
```

### Produção

Para compilar e rodar em produção:
```bash
npm run build
npm start
```

## 🏗️ Arquitetura e Tecnologias

### Stack Técnico

- **Discord.js** (v14.26.4) - Cliente Discord e gerenciamento de eventos
- **TypeScript** (v6.0.3) - Type-safe development
- **Axios** (v1.18.0) - Cliente HTTP para chamadas à API
- **Node-Cache** (v5.1.2) - Cache em memória para dados dos servidores
- **dotenv** (v17.4.2) - Gerenciamento de variáveis de ambiente

### Fluxo de Dados

```
UptimeRobot API
      ↓
  Axios Request
      ↓
  Validação & DNS Lookup
      ↓
  IP-API.com (Geolocalização)
      ↓
  Node Cache (5 min TTL)
      ↓
  Discord Embed
      ↓
  Usuário
```

## 📋 Estrutura do Projeto

```
src/
├── index.ts          # Arquivo principal do bot
├── types/            # Interfaces TypeScript
└── utils/            # Funções utilitárias
```

### Interfaces Principais

```typescript
interface ServerData {
    name: string;          // Nome do servidor
    address: string;       // Endereço de conexão
    ipv4: string;         // Endereço IPv4
    ping: string;         // Latência
    uptime: string;       // Porcentagem de uptime
    bandeira: string;     // Emoji de bandeira do país
    online: boolean;      // Status real do servidor
}
```

## 🔧 Configuração Avançada

### Cache

O sistema de cache utiliza configuração padrão:
- **TTL (Time to Live)**: 5 minutos (300 segundos)
- **Período de verificação**: 60 segundos
- **Clones desabilitados** para melhor performance

### DNS Lookup

- Resolve IPv4 dos servidores automaticamente
- Fallback para "Erro DNS" em caso de falha
- Timeout de conexão: 2 segundos

### Geolocalização

- Utiliza API [ip-api.com](http://ip-api.com)
- Converte country code (ISO 3166-1) para emoji de bandeira
- Fallback para 🌐 em caso de erro

## 📊 Permissões Necessárias

O bot precisa das seguintes permissões no Discord:

- ✅ `Send Messages` - Enviar mensagens
- ✅ `View Channels` - Visualizar canais
- ✅ `Manage Messages` - Deletar mensagens fora de contexto
- ✅ `Embed Links` - Enviar embeds
- ✅ `Use Application Commands` - Usar comandos slash

## 🐛 Tratamento de Erros

O bot implementa um sistema robusto de tratamento de erros:

- Fallback para cache quando API falha
- Timeout em chamadas HTTP (10s para UptimeRobot, 2s para verificação)
- Verificação de permissões antes de deletar mensagens
- Logs detalhados para debugging

## 📝 Exemplo de Uso

1. Invite o bot para seu servidor Discord
2. Dê permissões necessárias
3. Execute `/servidores` para ver servidores ativos
4. Use `/atualizar` para força a atualização
5. Use `/helper` para ver todos os comandos

## 🌐 Integrações Externas

- **UptimeRobot API** - Monitora status dos servidores
- **IP-API.com** - Geolocalização de IPs
- **DNS.lookup()** - Resolução de DNS nativa do Node.js

## ⚙️ Scripts Disponíveis

```bash
npm run dev      # Executa em modo desenvolvimento
npm run test     # Executa testes (não configurado)
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se livre para:

1. Fork o projeto
2. Criar uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abrir um Pull Request

## 📄 Licença

Este projeto está sob a licença **ISC**.

## 👤 Autor

**zeidlerneto1**

- GitHub: [@zeidlerneto1](https://github.com/zeidlerneto1)

## 📞 Suporte

Para relatórios de bugs ou sugestões, abra uma [Issue](https://github.com/zeidlerneto1/Bot-Discord-Switch-Lan-PLay/issues).

## 🎯 Roadmap Futuro

- [ ] Suporte a múltiplos idiomas
- [ ] Notificações quando servidor cai/sobe
- [ ] Dashboard web para estatísticas
- [ ] Filtro por país/região
- [ ] Histórico de uptime
- [ ] Ranking de servidores por ping

---

**Feito com ❤️ para a comunidade Lan-Play**
