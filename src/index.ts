import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, PermissionsBitField, Message } from 'discord.js';
import type { ApplicationCommandData } from 'discord.js';
import axios from 'axios';
import { promises as dns } from 'dns';
import NodeCache from 'node-cache';


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

interface ServerData {
    name: string;
    address: string;
    ipv4: string;
    ping: string;
    uptime: string;
    bandeira: string;
    online: boolean;
}

// 🗄️ Configuração do Cache
const cache = new NodeCache({
    stdTTL: 300,
    checkperiod: 60,
    useClones: false
});

const CACHE_KEYS = {
    SERVERS: 'servers_data',
    LAST_UPDATE: 'last_update'
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

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // ⚠️ PRECISA ATIVAR NO DEV PORTAL!
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

// 🗄️ Função para buscar dados da API (com cache)
async function buscarServidores(forcarAtualizacao: boolean = false): Promise<ServerData[]> {
    if (!forcarAtualizacao) {
        const cachedData = cache.get<ServerData[]>(CACHE_KEYS.SERVERS);
        if (cachedData) {
            console.log('📦 Dados do cache encontrados!');
            return cachedData;
        }
    }

    console.log('🔄 Buscando dados frescos da API...');

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
                timeout: 10000
            }
        );

        const monitors = response.data.monitors || [];
        const activeServers = monitors.filter(m => m.status === 2);

        const serverDataPromises = activeServers.map(async (server) => {
            const startTime = Date.now();
            let ping = 'Timeout';
            let onlineReal = false;
            let bandeira = '🌐';
            let ipv4 = 'Não encontrado';
            const serverUrl = server.url ?? '';

            const hostLimpo = serverUrl.replace(/^https?:\/\//, '').split('/')[0].split(':')[0] || '';

            try {
                const dnsLookup = await dns.lookup(hostLimpo, { family: 4 });
                ipv4 = dnsLookup.address;
            } catch {
                ipv4 = 'Erro DNS';
            }

            try {
                await axios.get(serverUrl, { timeout: 2000 });
                ping = `${Date.now() - startTime}ms`;
                onlineReal = true;
            } catch {
                ping = 'Timeout';
                onlineReal = false;
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

            return {
                name: server.friendly_name,
                address: connectionAddress,
                ipv4: ipv4,
                ping: ping,
                uptime: server.all_time_uptime_ratio || '0',
                bandeira: bandeira,
                online: onlineReal
            };
        });

        const serverData = await Promise.all(serverDataPromises);

        cache.set(CACHE_KEYS.SERVERS, serverData);
        cache.set(CACHE_KEYS.LAST_UPDATE, new Date().toISOString());

        console.log(`✅ ${serverData.length} servidores cacheados!`);
        return serverData;

    } catch (error) {
        console.error('Erro ao buscar servidores:', error);
        
        const cachedData = cache.get<ServerData[]>(CACHE_KEYS.SERVERS);
        if (cachedData) {
            console.log('⚠️ Usando dados em cache (mesmo que expirados) devido a erro.');
            return cachedData;
        }
        
        throw error;
    }
}

// 🔧 Função para limpar mensagens do canal
async function limparCanal(channel: any, quantidadeMaxima: number = 100) {
    try {
        const botMember = channel.guild?.members?.me;
        if (!botMember) return false;

        const hasPermission = channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageMessages);
        if (!hasPermission) return false;

        const messages = await channel.messages.fetch({ limit: quantidadeMaxima });
        const messagesDeletaveis = messages.filter(msg => 
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

// 🔧 Função para verificar permissões
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

// 📊 Função para criar o embed dos servidores
function criarEmbedServidores(servers: ServerData[], atualizadoEm?: string): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🌐 Servidores Ativos (Lan-Play)')
        .setDescription(`Atualmente existem **${servers.length}** servidores online de pé!`)
        .setColor('#00ff66')
        .setTimestamp();

    if (atualizadoEm) {
        embed.setFooter({ text: `Última atualização: ${atualizadoEm}` });
    }

    const fields = servers.slice(0, 25).map(server => ({
        name: `${server.online ? '🟢' : '🔴'} ${server.bandeira} ${server.name}`,
        value: `**Endereço:** \`${server.address}\`\n**IPv4:** \`${server.ipv4}\`\n**Latência:** \`${server.ping}\`\n**Uptime:** \`${server.uptime}%\``,
        inline: false
    }));

    embed.addFields(fields);

    if (servers.length > 25) {
        embed.setFooter({ text: `Mostrando 25 de ${servers.length} servidores.` });
    }

    return embed;
}

// 📊 Função para criar o embed do Helper
function criarEmbedHelper(): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🤖 Menu de Ajuda - Lan-Play Bot BY zeidlerneto1')
        .setDescription('Aqui estão todos os comandos e funcionalidades disponíveis:')
        .setColor('#0099ff')
        .setTimestamp()
        .setFooter({ text: 'Use os comandos para interagir com o bot!' });

    embed.addFields(
        {
            name: '📌 /servidores',
            value: 'Mostra todos os servidores Lan-Play ativos com:\n• Endereço de conexão\n• IPv4\n• Latência (ping)\n• Uptime\n• Bandeira do país',
            inline: false
        },
        {
            name: '🔄 /atualizar',
            value: 'Força a atualização do cache dos servidores. Útil quando você quer dados frescos!',
            inline: false
        },
        {
            name: '❓ /helper',
            value: 'Mostra este menu de ajuda com todos os comandos disponíveis.',
            inline: false
        },
        {
            name: '🧹 Limpeza automática',
            value: 'O bot automaticamente:\n• Limpa mensagens fora de contexto\n• Remove mensagens antigas do canal\n• Mantém o chat organizado',
            inline: false
        },
        {
            name: '⚡ Cache inteligente',
            value: 'Os dados são cacheados por 5 minutos para respostas mais rápidas!',
            inline: false
        }
    );

    return embed;
}

// 🎯 DETECTOR DE MENSAGENS FORA DE CONTEXTO
client.on('messageCreate', async (message: Message) => {
    // Ignora mensagens do próprio bot
    if (message.author.bot) return;
    
    // Ignora mensagens em DMs
    if (!message.guild) return;

    // Ignora comandos (começam com /)
    if (message.content.startsWith('/')) return;

    // 🔹 Verifica se a mensagem é um comando válido do bot
    const comandosValidos = ['servidores', 'atualizar', 'helper'];
    const conteudo = message.content.toLowerCase().trim();
    
    // Se a mensagem for um comando válido, ignora (já vai ser processado pelo interactionCreate)
    if (comandosValidos.some(cmd => conteudo === cmd || conteudo === '/' + cmd)) {
        return;
    }

    console.log(`🗣️ Mensagem fora de contexto detectada: "${message.content}" de ${message.author.tag}`);

    try {
        // 🔹 Verifica permissão para deletar
        const botMember = message.guild?.members?.me;
        const hasPermission = message.channel.permissionsFor(botMember!)?.has(PermissionsBitField.Flags.ManageMessages);
        
        if (hasPermission) {
            // 🔹 Apaga a mensagem fora de contexto
            await message.delete();
            console.log(`🗑️ Mensagem deletada: "${message.content}"`);
        }

        // 🔹 Verifica se pode enviar mensagem
        if (podeEnviarMensagem(message.channel)) {
            // 🔹 Envia o Helper
            const embed = criarEmbedHelper();
            
            // 🔹 Envia uma mensagem de aviso + helper
            const avisoMsg = await message.channel.send({
                content: `👋 Olá ${message.author}! Parece que você enviou uma mensagem fora do contexto. Aqui estão os comandos disponíveis:`,
                embeds: [embed]
            });

            // 🔹 Auto-deleta a mensagem do helper após 30 segundos (opcional)
            setTimeout(async () => {
                try {
                    await avisoMsg.delete();
                } catch (error) {
                    // Ignora se não conseguir deletar
                }
            }, 30000);
        }

    } catch (error: any) {
        if (error.code === 50013) {
            console.log('⚠️ Sem permissão para deletar mensagem');
        } else {
            console.error('Erro ao processar mensagem fora de contexto:', error);
        }
    }
});

// 🎯 Comandos Slash
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

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
                await interaction.channel.send('❌ Nenhum servidor ativo encontrado no momento.');
                return;
            }

            const lastUpdate = cache.get<string>(CACHE_KEYS.LAST_UPDATE);
            const dataAtualizada = lastUpdate ? new Date(lastUpdate).toLocaleString('pt-BR') : undefined;

            const embed = criarEmbedServidores(servers, dataAtualizada);
            await interaction.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao processar servidores:', error);
            await mensagemPensando.delete().catch(() => {});
            await interaction.channel.send('❌ Ocorreu um erro ao obter os dados dos servidores.').catch(() => {});
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
                await interaction.channel.send('❌ Nenhum servidor ativo encontrado no momento.');
                return;
            }

            const lastUpdate = cache.get<string>(CACHE_KEYS.LAST_UPDATE);
            const dataAtualizada = lastUpdate ? new Date(lastUpdate).toLocaleString('pt-BR') : undefined;

            const embed = criarEmbedServidores(servers, dataAtualizada);
            embed.setDescription(`✅ **Cache atualizado!** ${servers.length} servidores encontrados.`);

            await interaction.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao atualizar cache:', error);
            await mensagemPensando.delete().catch(() => {});
            await interaction.channel.send('❌ Ocorreu um erro ao atualizar os dados.').catch(() => {});
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
});

// 🔹 Tratamento de erros globais
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

client.login(process.env.DISCORD_TOKEN);