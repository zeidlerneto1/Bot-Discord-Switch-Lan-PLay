import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, PermissionsBitField, Message, ChannelType } from 'discord.js';
import type { ApplicationCommandData } from 'discord.js';
import axios from 'axios';
import { promises as dns } from 'dns';
import NodeCache from 'node-cache';
import net from 'net';
import WebSocket from 'ws';

interface Monitor {
    id: number;
    friendly_name: string;
    url: string;
    type: number;
    status: number;
    all_time_uptime_ratio: string;
}

interface UptimeRobotResponse {
    stat: string;
    pagination: {
        offset: number;
        limit: number;
        total: number;
    };
    monitors?: Monitor[];
}

interface Room {
    contentId: string;
    hostPlayerName: string;
    nodeCount: number;
    nodeCountMax: number;
    advertiseData: string;
    nodes: { playerName: string }[];
}

interface ServerData {
    name: string;
    address: string;
    ipv4: string;
    rtt: string;
    rttMicro: string;
    uptime: string;
    bandeira: string;
    online: boolean;
    statusIcon: string;
    tipo: string;
    activeUsers: number;
    idleUsers: number;
    totalUsers: number;
    rooms: Room[];
    gameInfo: string;
}

// 🗄️ Configuração do Cache
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

const CACHE_KEYS = {
    SERVERS: 'servers_data',
    TIMESTAMP: 'timestamp',
    LAST_UPDATE: 'last_update',
    API_RESPONSE_TIME: 'api_response_time'
};

// ⏱️ Configurações
const CONFIG = {
    CACHE_INTERVAL: 300,
    API_TIMEOUT: 30,
    PING_TIMEOUT: 3,
    RTT_SAMPLES: 1,
};

function siglaParaEmojiBandeira(countryCode: string): string {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    try {
        return String.fromCodePoint(...codePoints);
    } catch {
        return '🌐';
    }
}

// ============================================================
// 🔌 1. FUNÇÕES DE PING
// ============================================================

// ✅ PING VIA TCP (para servidores Node/DotNet)
function medirPingTCP(host: string, porta: number = 443): Promise<{ rtt: number; rttMicro: number }> {
    return new Promise((resolve) => {
        const startTime = process.hrtime.bigint();
        const socket = new net.Socket();
        
        const timeout = setTimeout(() => {
            socket.destroy();
            resolve({ rtt: -1, rttMicro: -1 });
        }, CONFIG.PING_TIMEOUT * 1000);
        
        socket.connect(porta, host, () => {
            const endTime = process.hrtime.bigint();
            const diffNs = Number(endTime - startTime);
            
            const rtt = Math.round((diffNs / 1_000_000) * 10) / 10;
            const rttMicro = Math.round(diffNs / 1_000);
            
            clearTimeout(timeout);
            socket.destroy();
            resolve({ rtt, rttMicro });
        });
        
        socket.on('error', () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve({ rtt: -1, rttMicro: -1 });
        });
    });
}

// ✅ PING VIA WEBSOCKET (para servidores Rust)
function medirPingWebSocket(host: string, port: number): Promise<{ rtt: number; rttMicro: number; data?: any }> {
    return new Promise((resolve) => {
        const startTime = process.hrtime.bigint();
        let messageSent = false;
        
        try {
            const ws = new WebSocket(`ws://${host}:${port}`, 'graphql-ws');
            
            const timeout = setTimeout(() => {
                ws.close();
                resolve({ rtt: -1, rttMicro: -1 });
            }, CONFIG.PING_TIMEOUT * 1000);
            
            ws.on('open', () => {
                ws.send('{"type":"connection_init","payload":{}}');
                
                setTimeout(() => {
                    const query = '{"id":"1","type":"start","payload":{"variables":{},"extensions":{},"operationName":null,"query":"subscription{serverInfo{online idle}}"}}';
                    ws.send(query);
                    messageSent = true;
                }, 100);
            });
            
            ws.on('message', (data) => {
                if (!messageSent) return;
                
                try {
                    const parsed = JSON.parse(data.toString());
                    
                    if (parsed.type === 'data' && parsed.id === '1') {
                        const endTime = process.hrtime.bigint();
                        const diffNs = Number(endTime - startTime);
                        
                        const rtt = Math.round((diffNs / 1_000_000) * 10) / 10;
                        const rttMicro = Math.round(diffNs / 1_000);
                        
                        clearTimeout(timeout);
                        ws.send('{"id":"1","type":"stop"}');
                        ws.close();
                        
                        resolve({
                            rtt,
                            rttMicro,
                            data: parsed.payload.data
                        });
                    }
                } catch (error) {
                    // Ignora erros de parsing
                }
            });
            
            ws.on('error', () => {
                clearTimeout(timeout);
                ws.close();
                resolve({ rtt: -1, rttMicro: -1 });
            });
            
        } catch (error) {
            resolve({ rtt: -1, rttMicro: -1 });
        }
    });
}

// ✅ DETECTA O TIPO DO SERVIDOR
async function detectarTipoServidor(host: string, port: number): Promise<'rust' | 'node' | 'dotnet'> {
    try {
        const ws = new WebSocket(`ws://${host}:${port}`, 'graphql-ws');
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                ws.close();
                testarHTTP(host, port).then(resolve);
            }, 1500);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                ws.close();
                resolve('rust');
            });
            
            ws.on('error', () => {
                clearTimeout(timeout);
                ws.close();
                testarHTTP(host, port).then(resolve);
            });
        });
    } catch {
        return 'node';
    }
}

// ✅ TESTA SE É NODE OU DOTNET VIA HTTP
async function testarHTTP(host: string, port: number): Promise<'rust' | 'node' | 'dotnet'> {
    try {
        const response = await axios.get(`http://${host}:${port}/info`, { timeout: 2000 });
        if (response.data && response.data.online !== undefined) {
            return 'node';
        }
        return 'dotnet';
    } catch {
        try {
            const response = await axios.get(`http://${host}:${port}`, { timeout: 2000 });
            if (response.data && response.data.clientCount !== undefined) {
                return 'dotnet';
            }
        } catch {}
        return 'node';
    }
}

// ✅ BUSCA SALAS VIA HTTP
async function buscarSalas(host: string, port: number): Promise<Room[]> {
    try {
        const response = await axios.post(
            `http://${host}:${port}`,
            {
                query: `{ room { contentId hostPlayerName nodeCount nodeCountMax advertiseData nodes { playerName } } }`
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 2000
            }
        );
        
        if (response.data && response.data.data && response.data.data.room) {
            return response.data.data.room;
        }
        return [];
    } catch {
        return [];
    }
}

// ✅ FUNÇÃO PRINCIPAL: Medir RTT com detecção automática
async function medirRTT(host: string, port: number = 11451): Promise<{
    rtt: number;
    rttMicro: number;
    tipo: string;
    activeUsers: number;
    idleUsers: number;
    totalUsers: number;
    rooms: Room[];
}> {
    let resultado = {
        rtt: -1,
        rttMicro: -1,
        tipo: 'desconhecido',
        activeUsers: 0,
        idleUsers: 0,
        totalUsers: 0,
        rooms: [] as Room[]
    };
    
    const tipo = await detectarTipoServidor(host, port);
    resultado.tipo = tipo;
    
    console.log(`🔍 Servidor ${host}:${port} é do tipo: ${tipo}`);
    
    if (tipo === 'rust') {
        const wsResult = await medirPingWebSocket(host, port);
        
        if (wsResult.rtt > 0) {
            resultado.rtt = wsResult.rtt;
            resultado.rttMicro = wsResult.rttMicro;
            
            if (wsResult.data && wsResult.data.serverInfo) {
                const { online, idle } = wsResult.data.serverInfo;
                resultado.totalUsers = online || 0;
                resultado.idleUsers = idle || 0;
                resultado.activeUsers = (online || 0) - (idle || 0);
            }
            
            try {
                resultado.rooms = await buscarSalas(host, port);
                console.log(`📋 ${resultado.rooms.length} salas encontradas`);
            } catch (error) {
                console.log('⚠️ Não foi possível buscar salas');
            }
        }
    } else {
        const tcpResult = await medirPingTCP(host, port);
        if (tcpResult.rtt > 0) {
            resultado.rtt = tcpResult.rtt;
            resultado.rttMicro = tcpResult.rttMicro;
        }
        
        try {
            const url = tipo === 'node' ? `/info` : ``;
            const response = await axios.get(`http://${host}:${port}${url}`, { timeout: 2000 });
            
            if (response.data) {
                if (tipo === 'node') {
                    resultado.totalUsers = response.data.online || 0;
                    resultado.idleUsers = response.data.idle || 0;
                    resultado.activeUsers = (response.data.online || 0) - (response.data.idle || 0);
                } else if (tipo === 'dotnet') {
                    resultado.totalUsers = response.data.clientCount || 0;
                    resultado.activeUsers = response.data.clientCount || 0;
                }
            }
        } catch (error) {
            console.log('⚠️ Não foi possível buscar dados HTTP');
        }
    }
    
    return resultado;
}

// ============================================================
// 📊 2. FUNÇÕES DO BOT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const commands: ApplicationCommandData[] = [
    {
        name: 'servidores',
        description: 'Mostra os servidores Lan-Play ativos, IPv4 e país.',
    },
    {
        name: 'atualizar',
        description: 'Força a atualização do cache dos servidores.',
    },
    {
        name: 'helper',
        description: 'Mostra todos os comandos e funcionalidades do bot.',
    },
    {
        name: 'status',
        description: 'Mostra o status do cache e últimas atualizações.',
    },
];

client.once('clientReady', async () => {
    console.log(`🤖 Bot conectado como ${client.user?.tag}!`);
    if (!client.user) return;

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comandos registrados com sucesso!');
        console.log(`📋 Comandos: ${commands.map(c => '/' + c.name).join(', ')}`);
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
});

// ============================================================
// 📡 3. BUSCAR SERVIDORES
// ============================================================

async function buscarServidores(forcarAtualizacao: boolean = false): Promise<ServerData[]> {
    if (!forcarAtualizacao) {
        const cachedData = cache.get<ServerData[]>(CACHE_KEYS.SERVERS);
        const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
        
        if (cachedData && timestamp && !isCacheExpired()) {
            console.log('📦 Dados do cache encontrados e ainda válidos!');
            return cachedData;
        }
    }

    console.log('🔄 Buscando dados frescos da API...');
    const apiStartTime = Date.now();

    try {
        const requestBody = `api_key=${process.env.UPTIMEROBOT_KEY}&format=json&all_time_uptime_ratio=1`;

        const response = await axios.post<UptimeRobotResponse>(
            'https://api.uptimerobot.com/v2/getMonitors',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
                    'Origin': 'http://www.lan-play.com',
                    'Referer': 'http://www.lan-play.com/'
                },
                timeout: CONFIG.API_TIMEOUT * 1000
            }
        );

        const apiResponseTime = Date.now() - apiStartTime;
        console.log(`⏱️ API respondeu em: ${apiResponseTime}ms`);

        const monitors = response.data.monitors || [];
        const activeServers = monitors.filter(m => m.status === 2);

        const serverDataPromises = activeServers.map(async (server) => {
            let bandeira = '🌐';
            let ipv4 = 'Não encontrado';
            const serverUrl = server.url ?? '';

            let host = serverUrl?.replace(/^https?:\/\//, '')?.split('/')[0]?.split(':')[0] || '';
            let port = 11451;
            
            const portMatch = serverUrl.match(/:(\d+)/);
            if (portMatch && portMatch[1]) {
                port = parseInt(portMatch[1]);
            }

            try {
                const dnsLookup = await dns.lookup(host, { family: 4 });
                ipv4 = dnsLookup.address;
            } catch {
                ipv4 = 'Erro DNS';
            }

            let rtt = 'Timeout';
            let rttMicro = '-';
            let onlineReal = false;
            let statusIcon = '🔴';
            let tipo = 'desconhecido';
            let activeUsers = 0;
            let idleUsers = 0;
            let totalUsers = 0;
            let rooms: Room[] = [];

            if (ipv4 !== 'Não encontrado' && ipv4 !== 'Erro DNS') {
                const result = await medirRTT(ipv4, port);
                
                tipo = result.tipo;
                activeUsers = result.activeUsers;
                idleUsers = result.idleUsers;
                totalUsers = result.totalUsers;
                rooms = result.rooms;
                
                if (result.rtt > 0) {
                    rtt = `${result.rtt.toFixed(1)}ms`;
                    rttMicro = `${result.rttMicro}µs`;
                    onlineReal = true;
                    
                    if (result.rtt < 50) statusIcon = '🟢';
                    else if (result.rtt < 150) statusIcon = '🟢';
                    else if (result.rtt < 300) statusIcon = '🟡';
                    else if (result.rtt < 500) statusIcon = '🟠';
                    else statusIcon = '🔴';
                }
            }

            if (ipv4 !== 'Não encontrado' && ipv4 !== 'Erro DNS') {
                try {
                    const geoRes = await axios.get(`http://ip-api.com/json/${ipv4}?fields=status,countryCode`, { timeout: 1500 });
                    if (geoRes.data && geoRes.data.status === 'success' && geoRes.data.countryCode) {
                        bandeira = siglaParaEmojiBandeira(geoRes.data.countryCode);
                    }
                } catch {
                    bandeira = '🌐';
                }
            }

            const connectionAddress = serverUrl.replace('http://', '').replace('https://', '').replace('/info', '');

            let gameInfo = '';
            if (rooms.length > 0) {
                const gameNames = rooms
                    .map(r => r.advertiseData?.split(';')[0] || '')
                    .filter(name => name && name.length > 0);
                const uniqueGames = [...new Set(gameNames)];
                if (uniqueGames.length > 0) {
                    gameInfo = uniqueGames.join(', ');
                }
            }

            return {
                name: server.friendly_name,
                address: connectionAddress,
                ipv4: ipv4,
                rtt: rtt,
                rttMicro: rttMicro,
                uptime: server.all_time_uptime_ratio || '0',
                bandeira: bandeira,
                online: onlineReal,
                statusIcon: statusIcon,
                tipo: tipo,
                activeUsers: activeUsers,
                idleUsers: idleUsers,
                totalUsers: totalUsers,
                rooms: rooms,
                gameInfo: gameInfo
            };
        });

        const serverData = await Promise.all(serverDataPromises);

        const now = Date.now();
        cache.set(CACHE_KEYS.SERVERS, serverData);
        cache.set(CACHE_KEYS.TIMESTAMP, now);
        cache.set(CACHE_KEYS.LAST_UPDATE, new Date(now).toISOString());
        cache.set(CACHE_KEYS.API_RESPONSE_TIME, apiResponseTime);

        const dataFormatada = new Date(now).toLocaleString('pt-BR');
        console.log(`✅ ${serverData.length} servidores cacheados!`);
        console.log(`📅 Timestamp: ${dataFormatada}`);

        return serverData;

    } catch (error) {
        console.error('❌ Erro ao buscar servidores:', error);
        
        const cachedData = cache.get<ServerData[]>(CACHE_KEYS.SERVERS);
        if (cachedData) {
            const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
            const dataFormatada = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : 'desconhecida';
            console.log(`⚠️ Usando dados em cache de ${dataFormatada} devido a erro.`);
            return cachedData;
        }
        
        throw error;
    }
}

function isCacheExpired(): boolean {
    const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
    if (!timestamp) return true;
    
    const now = Date.now();
    const elapsed = (now - timestamp) / 1000;
    
    console.log(`⏱️ Tempo desde última atualização: ${elapsed.toFixed(0)}s / ${CONFIG.CACHE_INTERVAL}s`);
    
    return elapsed >= CONFIG.CACHE_INTERVAL;
}

// ============================================================
// 🖥️ 4. FUNÇÕES DO DISCORD
// ============================================================

function podeEnviarMensagem(channel: any): boolean {
    try {
        const botMember = channel.guild?.members?.me;
        if (!botMember) return false;
        
        const permissions = channel.permissionsFor(botMember);
        if (!permissions) return false;
        
        return permissions.has(PermissionsBitField.Flags.SendMessages) && 
               permissions.has(PermissionsBitField.Flags.ViewChannel);
    } catch (error) {
        return false;
    }
}

async function limparCanal(channel: any, quantidadeMaxima: number = 100) {
    try {
        const botMember = channel.guild?.members?.me;
        if (!botMember) return false;

        const hasPermission = channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageMessages);
        if (!hasPermission) return false;

        const messages = await channel.messages.fetch({ limit: quantidadeMaxima });
        const messagesDeletaveis = messages.filter((msg: any) => 
            (Date.now() - msg.createdTimestamp) < 1209600000
        );
        
        if (messagesDeletaveis.size === 0) return true;
        
        if (messagesDeletaveis.size > 1) {
            await channel.bulkDelete(messagesDeletaveis, true);
        } else {
            await messagesDeletaveis.first()?.delete();
        }
        
        return true;

    } catch (error: any) {
        if (error.code === 50013 || error.code === 10008) {
            return false;
        }
        console.error('Erro ao limpar canal:', error);
        return false;
    }
}

// ============================================================
// 📊 5. EMBEDS
// ============================================================

function criarEmbedServidores(servers: ServerData[], atualizadoEm?: string, apiResponseTime?: number): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🌐 Servidores Ativos (Lan-Play)')
        .setDescription(`Atualmente existem **${servers.length}** servidores online de pé!`)
        .setColor('#00ff66')
        .setTimestamp();

    let footerText = `Cache: ${CONFIG.CACHE_INTERVAL}s | Amostras: ${CONFIG.RTT_SAMPLES}x`;
    if (atualizadoEm) {
        footerText += ` | Atualizado: ${atualizadoEm}`;
    }
    if (apiResponseTime) {
        footerText += ` | API: ${apiResponseTime}ms`;
    }
    embed.setFooter({ text: footerText });

    const fields = servers.slice(0, 25).map(server => {
        let value = `**Endereço:** \`${server.address}\`\n` +
                   `**IPv4:** \`${server.ipv4}\`\n` +
                   `**RTT:** \`${server.rtt}\`\n` +
                   `**RTT (µs):** \`${server.rttMicro}\`\n` +
                   `**Uptime:** \`${server.uptime}%\`\n` +
                   `**Tipo:** \`${server.tipo}\``;

        if (server.totalUsers > 0) {
            value += `\n**👥 Usuários:** \`${server.totalUsers}\``;
            if (server.activeUsers > 0) {
                value += ` (${server.activeUsers} ativos`;
                if (server.idleUsers > 0) {
                    value += `, ${server.idleUsers} inativos`;
                }
                value += `)`;
            }
        }

        if (server.gameInfo) {
            value += `\n**🎮 Jogos:** \`${server.gameInfo}\``;
        }

        if (server.rooms && server.rooms.length > 0) {
            const roomNames = server.rooms
                .slice(0, 3)
                .map(r => `${r.hostPlayerName || 'Sala'} (${r.nodeCount}/${r.nodeCountMax})`)
                .join(', ');
            value += `\n**📋 Salas:** \`${roomNames}\``;
            if (server.rooms.length > 3) {
                value += ` +${server.rooms.length - 3} mais`;
            }
        }

        return {
            name: `${server.statusIcon} ${server.bandeira} ${server.name}`,
            value: value,
            inline: false
        };
    });

    embed.addFields(fields);

    if (servers.length > 25) {
        embed.setFooter({ text: `Mostrando 25 de ${servers.length} servidores.` });
    }

    return embed;
}

function criarEmbedHelper(): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🤖 Menu de Ajuda - Lan-Play Bot')
        .setDescription('Aqui estão todos os comandos e funcionalidades disponíveis:')
        .setColor('#0099ff')
        .setTimestamp()
        .setFooter({ text: 'Use os comandos para interagir com o bot!' });

    embed.addFields(
        {
            name: '📌 /servidores',
            value: 'Mostra todos os servidores Lan-Play ativos com:\n• Endereço de conexão\n• IPv4\n• RTT em ms (1 casa decimal)\n• RTT em microssegundos (µs)\n• Uptime\n• Bandeira do país\n• Tipo do servidor (Rust/Node/DotNet)\n• Usuários ativos e inativos\n• Salas e jogos (quando disponível)',
            inline: false
        },
        {
            name: '🔄 /atualizar',
            value: 'Força a atualização do cache dos servidores.',
            inline: false
        },
        {
            name: '📊 /status',
            value: 'Mostra o status do cache e últimas atualizações.',
            inline: false
        },
        {
            name: '❓ /helper',
            value: 'Mostra este menu de ajuda.',
            inline: false
        },
        {
            name: '⚡ Configurações',
            value: `• Cache: ${CONFIG.CACHE_INTERVAL}s\n• Timeout: ${CONFIG.PING_TIMEOUT}s\n• Amostras: ${CONFIG.RTT_SAMPLES}x\n• Precisão: µs (microssegundos)\n• Suporte: Rust (WebSocket) + Node/DotNet (TCP)`,
            inline: false
        }
    );

    return embed;
}

// ============================================================
// 🎯 6. EVENTOS DO DISCORD
// ============================================================

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.content.startsWith('/')) return;

    const comandosValidos = ['servidores', 'atualizar', 'helper', 'status'];
    const conteudo = message.content.toLowerCase().trim();
    
    if (comandosValidos.some(cmd => conteudo === cmd || conteudo === '/' + cmd)) {
        return;
    }

    console.log(`🗣️ Mensagem fora de contexto detectada: "${message.content}" de ${message.author.tag}`);

    try {
        const botMember = message.guild?.members?.me;
        if (!botMember) return;

        // ✅ CORRIGIDO: Declara a variável fora do if
        let hasPermission = false;

        // Verifica se é um canal de texto (GuildText = 0, GuildPublicThread = 5)
        if (message.channel.type === ChannelType.GuildText || message.channel.type === ChannelType.GuildPublicThread) {
            hasPermission = message.channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageMessages) || false;
        }

        if (hasPermission) {
            await message.delete();
            console.log(`🗑️ Mensagem deletada: "${message.content}"`);
        }

        // Verifica se pode enviar mensagem
        if (message.channel.type === ChannelType.GuildText || message.channel.type === ChannelType.GuildPublicThread) {
            if (podeEnviarMensagem(message.channel)) {
                const embed = criarEmbedHelper();
                
                const avisoMsg = await message.channel.send({
                    content: `👋 Olá ${message.author}! Parece que você enviou uma mensagem fora do contexto. Aqui estão os comandos disponíveis:`,
                    embeds: [embed]
                });

                setTimeout(async () => {
                    try {
                        await avisoMsg.delete();
                    } catch (error) {
                        // Ignora
                    }
                }, 30000);
            }
        }

    } catch (error: any) {
        if (error.code === 50013) {
            console.log('⚠️ Sem permissão para deletar mensagem');
        } else {
            console.error('Erro ao processar mensagem fora de contexto:', error);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Função auxiliar para enviar mensagem com segurança
    async function sendToChannel(content: any): Promise<void> {
        if (interaction.channel && 'send' in interaction.channel) {
            await interaction.channel.send(content);
        }
    }

    // 📌 Comando: /servidores
    if (interaction.commandName === 'servidores') {
        if (!podeEnviarMensagem(interaction.channel)) {
            await interaction.reply({
                content: '❌ Não tenho permissão para enviar mensagens neste canal.',
                ephemeral: true
            });
            return;
        }

        const mensagemPensando = await interaction.reply({
            content: '🔄 **Buscando servidores...** Aguarde um momento!',
            fetchReply: true
        });

        try {
            const servers = await buscarServidores(false);
            
            await mensagemPensando.delete();
            await limparCanal(interaction.channel, 100);

            if (servers.length === 0) {
                await sendToChannel('❌ Nenhum servidor ativo encontrado no momento.');
                return;
            }

            const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
            const dataAtualizada = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : undefined;
            const apiResponseTime = cache.get<number>(CACHE_KEYS.API_RESPONSE_TIME);

            const embed = criarEmbedServidores(servers, dataAtualizada, apiResponseTime);
            await sendToChannel({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao processar servidores:', error);
            await mensagemPensando.delete().catch(() => {});
            await sendToChannel('❌ Ocorreu um erro ao obter os dados dos servidores.');
        }
    }

    // 📌 Comando: /atualizar
    if (interaction.commandName === 'atualizar') {
        if (!podeEnviarMensagem(interaction.channel)) {
            await interaction.reply({
                content: '❌ Não tenho permissão para enviar mensagens neste canal.',
                ephemeral: true
            });
            return;
        }

        const mensagemPensando = await interaction.reply({
            content: '🔄 **Atualizando cache dos servidores...** Aguarde um momento!',
            fetchReply: true
        });

        try {
            const servers = await buscarServidores(true);
            
            await mensagemPensando.delete();
            
            if (servers.length === 0) {
                await sendToChannel('❌ Nenhum servidor ativo encontrado no momento.');
                return;
            }

            const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
            const dataAtualizada = timestamp ? new Date(timestamp).toLocaleString('pt-BR') : undefined;
            const apiResponseTime = cache.get<number>(CACHE_KEYS.API_RESPONSE_TIME);

            const embed = criarEmbedServidores(servers, dataAtualizada, apiResponseTime);
            embed.setDescription(`✅ **Cache atualizado!** ${servers.length} servidores encontrados.`);

            await sendToChannel({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao atualizar cache:', error);
            await mensagemPensando.delete().catch(() => {});
            await sendToChannel('❌ Ocorreu um erro ao atualizar os dados.');
        }
    }

    // 📌 Comando: /helper
    if (interaction.commandName === 'helper') {
        if (!podeEnviarMensagem(interaction.channel)) {
            await interaction.reply({
                content: '❌ Não tenho permissão para enviar mensagens neste canal.',
                ephemeral: true
            });
            return;
        }

        const embed = criarEmbedHelper();
        
        await interaction.reply({
            content: '📚 **Aqui está o guia completo do bot:**',
            embeds: [embed]
        });
    }

    // 📌 Comando: /status
    if (interaction.commandName === 'status') {
        if (!podeEnviarMensagem(interaction.channel)) {
            await interaction.reply({
                content: '❌ Não tenho permissão para enviar mensagens neste canal.',
                ephemeral: true
            });
            return;
        }

        const timestamp = cache.get<number>(CACHE_KEYS.TIMESTAMP);
        const apiResponseTime = cache.get<number>(CACHE_KEYS.API_RESPONSE_TIME);
        const servers = cache.get<ServerData[]>(CACHE_KEYS.SERVERS);
        const isExpired = isCacheExpired();

        let rttMedio = 'N/A';
        if (servers && servers.length > 0) {
            const rtts = servers
                .filter(s => s.rtt !== 'Timeout' && !s.rtt.includes('Erro'))
                .map(s => parseFloat(s.rtt.replace('ms', '')));
            
            if (rtts.length > 0) {
                const media = rtts.reduce((a, b) => a + b, 0) / rtts.length;
                rttMedio = `${media.toFixed(1)}ms`;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Status do Bot')
            .setColor('#0099ff')
            .setTimestamp()
            .addFields(
                {
                    name: '📦 Cache',
                    value: servers ? `✅ ${servers.length} servidores` : '❌ Vazio',
                    inline: true
                },
                {
                    name: '⏱️ Intervalo',
                    value: `${CONFIG.CACHE_INTERVAL}s`,
                    inline: true
                },
                {
                    name: '📅 Última atualização',
                    value: timestamp ? new Date(timestamp).toLocaleString('pt-BR') : 'Nunca',
                    inline: false
                },
                {
                    name: '⏳ Status do cache',
                    value: isExpired ? '⚠️ Expirado' : '✅ Válido',
                    inline: true
                },
                {
                    name: '⏱️ Resposta da API',
                    value: apiResponseTime ? `${apiResponseTime}ms` : 'N/A',
                    inline: true
                },
                {
                    name: '📊 RTT Médio',
                    value: rttMedio,
                    inline: true
                },
                {
                    name: '⚙️ Configurações',
                    value: `Timeout: ${CONFIG.PING_TIMEOUT}s\nAmostras: ${CONFIG.RTT_SAMPLES}x\nPrecisão: µs\nSuporte: Rust (WS) + Node (TCP)`,
                    inline: false
                }
            );

        await interaction.reply({ embeds: [embed] });
    }
});

// ============================================================
// 🔹 TRATAMENTO DE ERROS
// ============================================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

client.login(process.env.DISCORD_TOKEN);