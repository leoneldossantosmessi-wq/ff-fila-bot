const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const config = require("./config.json");

// ======================================================
// CONFIGURAÇÕES
// ======================================================

config.token = process.env.TOKEN || config.token;
config.clientId = process.env.CLIENT_ID || config.clientId;
config.guildId = process.env.GUILD_ID || config.guildId;

if (!config.token) {
    console.error("❌ TOKEN não configurado.");
    process.exit(1);
}

if (!config.clientId) {
    console.error("❌ CLIENT_ID não configurado.");
    process.exit(1);
}

if (!config.guildId) {
    console.error("❌ GUILD_ID não configurado.");
    process.exit(1);
}

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ======================================================
// BANCO DE DADOS
// ======================================================

const dataDir = path.join(__dirname, "data");
const databaseFile = path.join(dataDir, "database.json");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, {
        recursive: true
    });
}

function createDefaultDatabase() {
    return {
        players: {},
        queue: [],
        matches: [],
        matchCounter: 0
    };
}

if (!fs.existsSync(databaseFile)) {
    fs.writeFileSync(
        databaseFile,
        JSON.stringify(
            createDefaultDatabase(),
            null,
            2
        )
    );
}

let db;

try {
    db = JSON.parse(
        fs.readFileSync(
            databaseFile,
            "utf8"
        )
    );

    // Proteção caso faltem propriedades
    db.players ??= {};
    db.queue ??= [];
    db.matches ??= [];
    db.matchCounter ??= 0;

} catch (error) {

    console.error(
        "❌ Erro ao ler database.json:",
        error
    );

    db = createDefaultDatabase();

    fs.writeFileSync(
        databaseFile,
        JSON.stringify(
            db,
            null,
            2
        )
    );
}

function saveDatabase() {

    try {

        fs.writeFileSync(
            databaseFile,
            JSON.stringify(
                db,
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            "❌ Erro ao salvar banco de dados:",
            error
        );
    }
}

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function isStaff(member) {

    if (!member) {
        return false;
    }

    if (
        member.permissions &&
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) {
        return true;
    }

    return Boolean(
        config.roles &&
        config.roles.staff &&
        member.roles &&
        member.roles.cache.has(
            config.roles.staff
        )
    );
}

// ======================================================
// MÁXIMO DA FILA
// ======================================================

function getMaxPlayers() {

    // A fila deste bot fica limitada a 8.
    return 8;
}

// ======================================================
// JOGADOR
// ======================================================

function getPlayer(userId) {

    if (!db.players[userId]) {

        db.players[userId] = {
            id: userId,
            wins: 0,
            losses: 0,
            points: 0,
            matches: 0
        };

        saveDatabase();
    }

    return db.players[userId];
}

// ======================================================
// LISTA DE JOGADORES
// ======================================================

function createPlayerList(ids) {

    if (!ids || ids.length === 0) {
        return "Nenhum jogador.";
    }

    return ids
        .map(
            (id, index) =>
                `${index + 1}. <@${id}>`
        )
        .join("\n");
}

// ======================================================
// EMBED DA FILA
// ======================================================

function createQueueEmbed() {

    const queue = db.queue || [];
    const maxPlayers = getMaxPlayers();

    return new EmbedBuilder()
        .setTitle("🎮 FILA DE APOSTADOS")
        .setDescription(
            "Entre na fila para participar da próxima partida."
        )
        .addFields(
            {
                name: "👥 Jogadores",
                value:
                    `${queue.length}/${maxPlayers}`,
                inline: true
            },
            {
                name: "📋 Fila atual",
                value:
                    createPlayerList(queue),
                inline: false
            }
        )
        .setFooter({
            text:
                "ORG Free Fire • Sistema de Filas"
        });
}

// ======================================================
// BOTÕES DA FILA
// ======================================================

function createQueueButtons() {

    return new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId("queue_join")
                .setLabel("ENTRAR NA FILA")
                .setEmoji("🎮")
                .setStyle(
                    ButtonStyle.Success
                ),

            new ButtonBuilder()
                .setCustomId("queue_leave")
                .setLabel("SAIR DA FILA")
                .setEmoji("🚪")
                .setStyle(
                    ButtonStyle.Danger
                ),

            new ButtonBuilder()
                .setCustomId("queue_view")
                .setLabel("VER FILA")
                .setEmoji("📋")
                .setStyle(
                    ButtonStyle.Primary
                )
        );
}

// ======================================================
// ATUALIZAR PAINEL
// ======================================================

async function updateQueuePanel(channel) {

    if (!channel) {
        return;
    }

    try {

        const messages =
            await channel.messages.fetch({
                limit: 20
            });

        const panel =
            messages.find(
                message =>
                    message.author.id ===
                        client.user.id &&
                    message.components.length > 0
            );

        if (!panel) {
            return;
        }

        await panel.edit({
            embeds: [
                createQueueEmbed()
            ],
            components: [
                createQueueButtons()
            ]
        });

    } catch (error) {

        console.error(
            "❌ Erro ao atualizar painel:",
            error
        );
    }
}

// ======================================================
// CRIAR PARTIDA AUTOMÁTICA COM 8
// ======================================================

async function createMatch(
    guild,
    channel
) {

    const maxPlayers = getMaxPlayers();

    const playersPerTeam =
        Math.floor(
            maxPlayers / 2
        );

    if (
        db.queue.length <
        maxPlayers
    ) {
        return;
    }

    const players =
        [...db.queue].slice(
            0,
            maxPlayers
        );

    db.queue =
        db.queue.slice(
            maxPlayers
        );

    db.matchCounter++;

    const matchId =
        db.matchCounter;

    const shuffled =
        [...players].sort(
            () => Math.random() - 0.5
        );

    const teamA =
        shuffled.slice(
            0,
            playersPerTeam
        );

    const teamB =
        shuffled.slice(
            playersPerTeam,
            maxPlayers
        );

    const match = {

        id: matchId,

        players: players,

        teamA: teamA,

        teamB: teamB,

        status: "waiting",

        winner: null,

        createdAt:
            new Date().toISOString()
    };

    db.matches.push(match);

    players.forEach(
        id => {

            const player =
                getPlayer(id);

            player.matches++;
        }
    );

    saveDatabase();

    const embed =
        new EmbedBuilder()
            .setTitle(
                `🔥 PARTIDA #${matchId}`
            )
            .setDescription(
                "A fila está completa! Uma nova partida foi criada."
            )
            .addFields(
                {
                    name: "🔵 TIME A",
                    value:
                        createPlayerList(
                            teamA
                        )
                },
                {
                    name: "🔴 TIME B",
                    value:
                        createPlayerList(
                            teamB
                        )
                },
                {
                    name: "📊 Status",
                    value:
                        "Aguardando resultado"
                }
            )
            .setFooter({
                text:
                    "Boa partida!"
            });

    await channel.send({

        content:
            players
                .map(
                    id => `<@${id}>`
                )
                .join(" "),

        embeds: [
            embed
        ]
    });

    if (
        guild &&
        config.channels &&
        config.channels.logs
    ) {

        const logsChannel =
            guild.channels.cache.get(
                config.channels.logs
            );

        if (logsChannel) {

            await logsChannel.send({

                embeds: [

                    new EmbedBuilder()
                        .setTitle(
                            "📝 Nova partida"
                        )
                        .setDescription(
                            `Partida #${matchId} criada.`
                        )
                        .addFields(
                            {
                                name:
                                    "Time A",
                                value:
                                    createPlayerList(
                                        teamA
                                    )
                            },
                            {
                                name:
                                    "Time B",
                                value:
                                    createPlayerList(
                                        teamB
                                    )
                            }
                        )
                ]
            });
        }
    }

    await updateQueuePanel(
        channel
    );
}

// ======================================================
// COMANDOS
// ======================================================

const commands = [

    // ==================================================
    // PAINEL
    // ==================================================

    new SlashCommandBuilder()
        .setName("painel")
        .setDescription(
            "Cria o painel da fila"
        ),

    // ==================================================
    // FILA
    // ==================================================

    new SlashCommandBuilder()
        .setName("fila")
        .setDescription(
            "Mostra a fila atual"
        ),

    // ==================================================
    // LIMPAR FILA
    // ==================================================

    new SlashCommandBuilder()
        .setName("limparfila")
        .setDescription(
            "Limpa a fila"
        ),

    // ==================================================
    // RESULTADO
    // ==================================================

    new SlashCommandBuilder()
        .setName("resultado")
        .setDescription(
            "Registra o resultado de uma partida"
        )
        .addIntegerOption(
            option =>
                option
                    .setName("partida")
                    .setDescription(
                        "Número da partida"
                    )
                    .setRequired(true)
        )
        .addStringOption(
            option =>
                option
                    .setName("vencedor")
                    .setDescription(
                        "Time vencedor"
                    )
                    .setRequired(true)
                    .addChoices(
                        {
                            name: "Time A",
                            value: "A"
                        },
                        {
                            name: "Time B",
                            value: "B"
                        }
                    )
        ),

    // ==================================================
    // RANKING
    // ==================================================

    new SlashCommandBuilder()
        .setName("ranking")
        .setDescription(
            "Mostra o ranking dos jogadores"
        ),

    // ==================================================
    // PERFIL
    // ==================================================

    new SlashCommandBuilder()
        .setName("perfil")
        .setDescription(
            "Mostra o perfil de um jogador"
        )
        .addUserOption(
            option =>
                option
                    .setName("jogador")
                    .setDescription(
                        "Jogador"
                    )
                    .setRequired(false)
        ),

   // ==================================================
// SALA
// ==================================================

new SlashCommandBuilder()
    .setName("sala")
    .setDescription(
        "Envia o ID e senha da sala para os jogadores escolhidos."
    )

    // OBRIGATÓRIOS PRIMEIRO
    .addUserOption(
        option =>
            option
                .setName("jogador1")
                .setDescription(
                    "Primeiro jogador"
                )
                .setRequired(true)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador2")
                .setDescription(
                    "Segundo jogador"
                )
                .setRequired(true)
    )

    .addStringOption(
        option =>
            option
                .setName("id")
                .setDescription(
                    "ID da sala"
                )
                .setRequired(true)
    )

    .addStringOption(
        option =>
            option
                .setName("senha")
                .setDescription(
                    "Senha da sala"
                )
                .setRequired(true)
    )

    // OPCIONAIS DEPOIS
    .addUserOption(
        option =>
            option
                .setName("jogador3")
                .setDescription(
                    "Terceiro jogador"
                )
                .setRequired(false)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador4")
                .setDescription(
                    "Quarto jogador"
                )
                .setRequired(false)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador5")
                .setDescription(
                    "Quinto jogador"
                )
                .setRequired(false)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador6")
                .setDescription(
                    "Sexto jogador"
                )
                .setRequired(false)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador7")
                .setDescription(
                    "Sétimo jogador"
                )
                .setRequired(false)
    )

    .addUserOption(
        option =>
            option
                .setName("jogador8")
                .setDescription(
                    "Oitavo jogador"
                )
                .setRequired(false)
), 

        .addUserOption(
            option =>
                option
                    .setName("jogador2")
                    .setDescription(
                        "Segundo jogador"
                    )
                    .setRequired(true)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador3")
                    .setDescription(
                        "Terceiro jogador"
                    )
                    .setRequired(false)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador4")
                    .setDescription(
                        "Quarto jogador"
                    )
                    .setRequired(false)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador5")
                    .setDescription(
                        "Quinto jogador"
                    )
                    .setRequired(false)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador6")
                    .setDescription(
                        "Sexto jogador"
                    )
                    .setRequired(false)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador7")
                    .setDescription(
                        "Sétimo jogador"
                    )
                    .setRequired(false)
        )

        .addUserOption(
            option =>
                option
                    .setName("jogador8")
                    .setDescription(
                        "Oitavo jogador"
                    )
                    .setRequired(false)
        )

        .addStringOption(
            option =>
                option
                    .setName("id")
                    .setDescription(
                        "ID da sala"
                    )
                    .setRequired(true)
        )

        .addStringOption(
            option =>
                option
                    .setName("senha")
                    .setDescription(
                        "Senha da sala"
                    )
                    .setRequired(true)
        )
];

// ======================================================
// REGISTRAR COMANDOS
// ======================================================

const rest =
    new REST({
        version: "10"
    }).setToken(
        config.token
    );

async function registerCommands() {

    try {

        console.log(
            "🔄 Registrando comandos..."
        );

        await rest.put(

            Routes.applicationGuildCommands(
                config.clientId,
                config.guildId
            ),

            {
                body:
                    commands.map(
                        command =>
                            command.toJSON()
                    )
            }
        );

        console.log(
            "✅ Comandos registrados!"
        );

    } catch (error) {

        console.error(
            "❌ ERRO AO REGISTRAR COMANDOS:",
            error
        );
    }
}

// ======================================================
// INTERAÇÕES
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // ==================================================
            // BOTÕES
            // ==================================================

            if (
                interaction.isButton()
            ) {

                const userId =
                    interaction.user.id;

                // ==================================================
                // ENTRAR
                // ==================================================

                if (
                    interaction.customId ===
                    "queue_join"
                ) {

                    if (
                        db.queue.includes(
                            userId
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "❌ Você já está na fila.",

                            flags: 64
                        });
                    }

                    const maxPlayers =
                        getMaxPlayers();

                    if (
                        db.queue.length >=
                        maxPlayers
                    ) {

                        return interaction.reply({

                            content:
                                "❌ A fila está cheia.",

                            flags: 64
                        });
                    }

                    db.queue.push(
                        userId
                    );

                    getPlayer(
                        userId
                    );

                    saveDatabase();

                    await interaction.reply({

                        content:
                            `✅ Você entrou na fila!\n📍 Posição: ${
                                db.queue.indexOf(
                                    userId
                                ) + 1
                            }/${maxPlayers}`,

                        flags: 64
                    });

                    await updateQueuePanel(
                        interaction.channel
                    );

                                        // Criar partida quando chegar a 8
                    if (
                        db.queue.length >=
                        maxPlayers
                    ) {

                        await createMatch(
                            interaction.guild,
                            interaction.channel
                        );
                    }

                    return;
                }

                // ==================================================
                // SAIR
                // ==================================================

                if (
                    interaction.customId ===
                    "queue_leave"
                ) {

                    const index =
                        db.queue.indexOf(
                            userId
                        );

                    if (
                        index === -1
                    ) {

                        return interaction.reply({
                            content:
                                "❌ Você não está na fila.",
                            flags: 64
                        });
                    }

                    db.queue.splice(
                        index,
                        1
                    );

                    saveDatabase();

                    await interaction.reply({
                        content:
                            "✅ Você saiu da fila.",
                        flags: 64
                    });

                    await updateQueuePanel(
                        interaction.channel
                    );

                    return;
                }

                // ==================================================
                // VER FILA
                // ==================================================

                if (
                    interaction.customId ===
                    "queue_view"
                ) {

                    return interaction.reply({

                        embeds: [
                            createQueueEmbed()
                        ],

                        flags: 64
                    });
                }

                return;
            }

            // ==================================================
            // SLASH COMMANDS
            // ==================================================

            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }

            // ==================================================
            // PAINEL
            // ==================================================

            if (
                interaction.commandName ===
                "painel"
            ) {

                if (
                    !isStaff(
                        interaction.member
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Apenas a Staff pode usar este comando.",
                        flags: 64
                    });
                }

                await interaction.deferReply({
                    flags: 64
                });

                await interaction.channel.send({

                    embeds: [
                        createQueueEmbed()
                    ],

                    components: [
                        createQueueButtons()
                    ]
                });

                return interaction.editReply({
                    content:
                        "✅ Painel criado."
                });
            }

            // ==================================================
            // FILA
            // ==================================================

            if (
                interaction.commandName ===
                "fila"
            ) {

                return interaction.reply({

                    embeds: [
                        createQueueEmbed()
                    ]
                });
            }

            // ==================================================
            // LIMPAR FILA
            // ==================================================

            if (
                interaction.commandName ===
                "limparfila"
            ) {

                if (
                    !isStaff(
                        interaction.member
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Apenas a Staff pode usar este comando.",
                        flags: 64
                    });
                }

                await interaction.deferReply({
                    flags: 64
                });

                db.queue = [];

                saveDatabase();

                await updateQueuePanel(
                    interaction.channel
                );

                return interaction.editReply({
                    content:
                        "🧹 Fila limpa com sucesso."
                });
            }

            // ==================================================
            // RESULTADO
            // ==================================================

            if (
                interaction.commandName ===
                "resultado"
            ) {

                if (
                    !isStaff(
                        interaction.member
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Apenas a Staff pode usar este comando.",
                        flags: 64
                    });
                }

                const partida =
                    interaction.options.getInteger(
                        "partida"
                    );

                const vencedor =
                    interaction.options.getString(
                        "vencedor"
                    );

                const match =
                    db.matches.find(
                        m =>
                            m.id ===
                            partida
                    );

                if (!match) {

                    return interaction.reply({
                        content:
                            "❌ Essa partida não existe.",
                        flags: 64
                    });
                }

                if (
                    match.status ===
                    "finished"
                ) {

                    return interaction.reply({
                        content:
                            "❌ O resultado dessa partida já foi registrado.",
                        flags: 64
                    });
                }

                const winners =
                    vencedor === "A"
                        ? match.teamA
                        : match.teamB;

                const losers =
                    vencedor === "A"
                        ? match.teamB
                        : match.teamA;

                winners.forEach(
                    id => {

                        const player =
                            getPlayer(id);

                        player.wins++;
                        player.points += 3;
                    }
                );

                losers.forEach(
                    id => {

                        const player =
                            getPlayer(id);

                        player.losses++;
                    }
                );

                match.status =
                    "finished";

                match.winner =
                    vencedor;

                match.finishedAt =
                    new Date().toISOString();

                saveDatabase();

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🏆 RESULTADO"
                        )
                        .setDescription(
                            `Partida **#${partida}** finalizada.`
                        )
                        .addFields(
                            {
                                name:
                                    "🏆 Vencedor",
                                value:
                                    vencedor === "A"
                                        ? "🔵 Time A"
                                        : "🔴 Time B"
                            },
                            {
                                name:
                                    "🔵 Time A",
                                value:
                                    createPlayerList(
                                        match.teamA
                                    )
                            },
                            {
                                name:
                                    "🔴 Time B",
                                value:
                                    createPlayerList(
                                        match.teamB
                                    )
                            }
                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [
                        embed
                    ]
                });
            }

            // ==================================================
            // RANKING
            // ==================================================

            if (
                interaction.commandName ===
                "ranking"
            ) {

                const players =
                    Object.values(
                        db.players
                    );

                if (
                    players.length ===
                    0
                ) {

                    return interaction.reply({
                        content:
                            "📊 Ainda não existem jogadores no ranking.",
                        flags: 64
                    });
                }

                players.sort(
                    (a, b) =>
                        b.points -
                        a.points
                );

                const top =
                    players
                        .slice(0, 10)
                        .map(
                            (player, index) =>
                                `**${index + 1}.** <@${player.id}> — **${player.points} pts** | ${player.wins}W / ${player.losses}L`
                        )
                        .join("\n");

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🏆 RANKING"
                        )
                        .setDescription(
                            top
                        )
                        .setFooter({
                            text:
                                "Top 10 jogadores"
                        });

                return interaction.reply({
                    embeds: [
                        embed
                    ]
                });
            }

            // ==================================================
            // PERFIL
            // ==================================================

            if (
                interaction.commandName ===
                "perfil"
            ) {

                const user =
                    interaction.options.getUser(
                        "jogador"
                    ) ||
                    interaction.user;

                const player =
                    getPlayer(
                        user.id
                    );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `👤 PERFIL DE ${user.username}`
                        )
                        .setThumbnail(
                            user.displayAvatarURL()
                        )
                        .addFields(
                            {
                                name:
                                    "🏆 Vitórias",
                                value:
                                    `${player.wins}`,
                                inline: true
                            },
                            {
                                name:
                                    "❌ Derrotas",
                                value:
                                    `${player.losses}`,
                                inline: true
                            },
                            {
                                name:
                                    "⭐ Pontos",
                                value:
                                    `${player.points}`,
                                inline: true
                            },
                            {
                                name:
                                    "🎮 Partidas",
                                value:
                                    `${player.matches}`,
                                inline: true
                            }
                        );

                return interaction.reply({
                    embeds: [
                        embed
                    ]
                });
            }

            // ==================================================
            // SALA
            // ==================================================

            if (
                interaction.commandName ===
                "sala"
            ) {

                if (
                    !isStaff(
                        interaction.member
                    )
                ) {

                    return interaction.reply({
                        content:
                            "❌ Apenas a Staff pode usar este comando.",
                        flags: 64
                    });
                }

                const jogadores = [];

                for (
                    let i = 1;
                    i <= 8;
                    i++
                ) {

                    const jogador =
                        interaction.options.getUser(
                            `jogador${i}`
                        );

                    if (jogador) {
                        jogadores.push(
                            jogador
                        );
                    }
                }

                if (
                    jogadores.length <
                    2
                ) {

                    return interaction.reply({
                        content:
                            "❌ É necessário escolher pelo menos 2 jogadores.",
                        flags: 64
                    });
                }

                const ids =
                    jogadores.map(
                        jogador =>
                            jogador.id
                    );

                const idsUnicos =
                    new Set(ids);

                if (
                    idsUnicos.size !==
                    ids.length
                ) {

                    return interaction.reply({
                        content:
                            "❌ Não podes escolher o mesmo jogador mais de uma vez.",
                        flags: 64
                    });
                }

                const idSala =
                    interaction.options.getString(
                        "id"
                    );

                const senha =
                    interaction.options.getString(
                        "senha"
                    );

                const mensagemSala =
                    [
                        "🎮 **SALA DA PARTIDA**",
                        "",
                        `👥 **Jogadores:** ${jogadores.length}`,
                        `🆔 **ID:** \`${idSala}\``,
                        `🔐 **Senha:** \`${senha}\``,
                        "",
                        "⚠️ Não compartilhe o ID e a senha.",
                        "",
                        "🔥 Boa partida!"
                    ].join("\n");

                await interaction.deferReply({
                    flags: 64
                });

                const enviados = [];
                const falharam = [];

                for (
                    const jogador of jogadores
                ) {

                    try {

                        await jogador.send(
                            mensagemSala
                        );

                        enviados.push(
                            jogador
                        );

                    } catch (error) {

                        console.error(
                            `❌ Não foi possível enviar DM para ${jogador.tag}:`,
                            error
                        );

                        falharam.push(
                            jogador
                        );
                    }
                }

                let resposta =
                    `✅ **Sala enviada!**\n\n📩 Dados enviados para **${enviados.length}/${jogadores.length}** jogadores.`;

                if (
                    falharam.length >
                    0
                ) {

                    resposta +=
                        `\n\n⚠️ Não foi possível enviar DM para: ${falharam.map(j => j.tag).join(", ")}.`;
                }

                return interaction.editReply({
                    content:
                        resposta
                });
            }

            return interaction.reply({
                content:
                    "❌ Comando não reconhecido.",
                flags: 64
            });

        } catch (error) {

            console.error(
                "❌ ERRO NA INTERAÇÃO:",
                error
            );

            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.editReply({
                        content:
                            "❌ Ocorreu um erro ao executar este comando."
                    });

                } else {

                    await interaction.reply({
                        content:
                            "❌ Ocorreu um erro ao executar este comando.",
                        flags: 64
                    });
                }

            } catch (replyError) {

                console.error(
                    "❌ Não foi possível responder à interação:",
                    replyError
                );
            }
        }
    }
);

// ======================================================
// BOT ONLINE
// ======================================================

client.once(
    "ready",
    async () => {

        console.log(
            `🤖 Bot online como ${client.user.tag}`
        );

        try {

            await registerCommands();

            console.log(
                "🚀 Sistema iniciado com sucesso!"
            );

        } catch (error) {

            console.error(
                "❌ Erro durante inicialização:",
                error
            );
        }
    }
);

// ======================================================
// ERROS GERAIS
// ======================================================

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ Unhandled Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ Uncaught Exception:",
            error
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(
    config.token
);
