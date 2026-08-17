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
const http = require("http");

const config = require("./config.json");

config.token = process.env.TOKEN || config.token;
config.clientId = process.env.CLIENT_ID || config.clientId;
config.guildId = process.env.GUILD_ID || config.guildId;

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
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(databaseFile)) {
    fs.writeFileSync(
        databaseFile,
        JSON.stringify(
            {
                players: {},
                queue: [],
                matches: [],
                matchCounter: 0
            },
            null,
            2
        )
    );
}

let db = JSON.parse(
    fs.readFileSync(databaseFile, "utf8")
);

function saveDatabase() {
    fs.writeFileSync(
        databaseFile,
        JSON.stringify(db, null, 2)
    );
}


// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function isStaff(member) {
    if (!member) return false;

    return (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        ) ||
        (
            config.roles &&
            config.roles.staff &&
            member.roles.cache.has(
                config.roles.staff
            )
        )
    );
}


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


function createQueueEmbed() {

    const queue = db.queue || [];

    return new EmbedBuilder()
        .setTitle("🎮 FILA DE APOSTADOS")
        .setDescription(
            "Entre na fila para participar da próxima partida."
        )
        .addFields(
            {
                name: "👥 Jogadores",
                value:
                    `${queue.length}/${config.queue.maxPlayers}`,
                inline: true
            },
            {
                name: "📋 Fila atual",
                value: createPlayerList(queue),
                inline: false
            }
        )
        .setFooter({
            text:
                "ORG Free Fire • Sistema de Filas"
        });
}


function createQueueButtons() {

    return new ActionRowBuilder()
        .addComponents(

            new ButtonBuilder()
                .setCustomId("queue_join")
                .setLabel("ENTRAR NA FILA")
                .setEmoji("🎮")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("queue_leave")
                .setLabel("SAIR DA FILA")
                .setEmoji("🚪")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("queue_view")
                .setLabel("VER FILA")
                .setEmoji("📋")
                .setStyle(ButtonStyle.Primary)
        );
}


// ======================================================
// ATUALIZAR PAINEL
// ======================================================

async function updateQueuePanel(channel) {

    if (!channel) return;

    const messages =
        await channel.messages.fetch({
            limit: 20
        });

    const panel =
        messages.find(
            msg =>
                msg.author.id === client.user.id &&
                msg.components.length > 0
        );

    if (!panel) return;

    await panel.edit({
        embeds: [
            createQueueEmbed()
        ],
        components: [
            createQueueButtons()
        ]
    });
}


// ======================================================
// CRIAR PARTIDA
// ======================================================

async function createMatch(guild, channel) {

    if (
        db.queue.length <
        config.queue.maxPlayers
    ) {
        return;
    }

    const players = [
        ...db.queue
    ];

    db.queue = [];

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
            config.queue.playersPerTeam
        );

    const teamB =
        shuffled.slice(
            config.queue.playersPerTeam,
            config.queue.maxPlayers
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

    players.forEach(id => {

        const player =
            getPlayer(id);

        player.matches++;
    });

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
                        createPlayerList(teamA)
                },
                {
                    name: "🔴 TIME B",
                    value:
                        createPlayerList(teamB)
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
        embeds: [embed]
    });

    if (
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
                                name: "Time A",
                                value:
                                    createPlayerList(
                                        teamA
                                    )
                            },
                            {
                                name: "Time B",
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

    await updateQueuePanel(channel);
}


// ======================================================
// COMANDOS
// ======================================================

const commands = [

    new SlashCommandBuilder()
        .setName("painel")
        .setDescription(
            "Cria o painel da fila"
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator.toString()
        ),

    new SlashCommandBuilder()
        .setName("fila")
        .setDescription(
            "Mostra a fila atual"
        ),

    new SlashCommandBuilder()
        .setName("limparfila")
        .setDescription(
            "Limpa a fila"
        )
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator.toString()
        ),

    new SlashCommandBuilder()
        .setName("resultado")
        .setDescription(
            "Registra o resultado de uma partida"
        )
        .addIntegerOption(option =>
            option
                .setName("partida")
                .setDescription(
                    "Número da partida"
                )
                .setRequired(true)
        )
        .addStringOption(option =>
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

    new SlashCommandBuilder()
        .setName("ranking")
        .setDescription(
            "Mostra o ranking dos jogadores"
        ),

    new SlashCommandBuilder()
        .setName("perfil")
        .setDescription(
            "Mostra o perfil de um jogador"
        )
        .addUserOption(option =>
            option
                .setName("jogador")
                .setDescription(
                    "Jogador"
                )
                .setRequired(false)
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
            "Registrando comandos..."
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
            "Comandos registrados!"
        );

    } catch (error) {

        console.error(
            "ERRO AO REGISTRAR COMANDOS:",
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

            if (interaction.isButton()) {

                const userId =
                    interaction.user.id;


                // ENTRAR NA FILA

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

                    if (
                        db.queue.length >=
                        config.queue.maxPlayers
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

                    saveDatabase();

                    await interaction.reply({
                        content:
                            `✅ Você entrou na fila!\n📍 Posição: ${
                                db.queue.indexOf(
                                    userId
                                ) + 1
                            }`,
                        flags: 64
                    });

                    await updateQueuePanel(
                        interaction.channel
                    );

                    if (
                        db.queue.length >=
                        config.queue.maxPlayers
                    ) {

                        await createMatch(
                            interaction.guild,
                            interaction.channel
                        );
                    }

                    return;
                }


                // SAIR DA FILA

                if (
                    interaction.customId ===
                    "queue_leave"
                ) {

                    const index =
                        db.queue.indexOf(
                            userId
                        );

                    if (index === -1) {

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


                // VER FILA

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
                            "❌ Apenas a Staff pode registrar resultados.",
                        flags: 64
                    });
                }

                const matchId =
                    interaction.options.getInteger(
                        "partida"
                    );

                const winner =
                    interaction.options.getString(
                        "vencedor"
                    );

                const match =
                    db.matches.find(
                        m =>
                            m.id ===
                            matchId
                    );

                if (!match) {

                    return interaction.reply({
                        content:
                            "❌ Partida não encontrada.",
                        flags: 64
                    });
                }

                if (
                    match.status ===
                    "finished"
                ) {

                    return interaction.reply({
                        content:
                            "❌ Esta partida já possui resultado.",
                        flags: 64
                    });
                }

                const winners =
                    winner === "A"
                        ? match.teamA
                        : match.teamB;

                const losers =
                    winner === "A"
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
                    winner;

                match.finishedAt =
                    new Date().toISOString();

                saveDatabase();

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `🏆 RESULTADO — PARTIDA #${matchId}`
                        )
                        .addFields(
                            {
                                name:
                                    "🥇 Vencedor",
                                value:
                                    winner === "A"
                                        ? "🔵 Time A"
                                        : "🔴 Time B"
                            },
                            {
                                name:
                                    "Time A",
                                value:
                                    createPlayerList(
                                        match.teamA
                                    )
                            },
                            {
                                name:
                                    "Time B",
                                value:
                                    createPlayerList(
                                        match.teamB
                                    )
                            }
                        );

                if (
                    config.channels &&
                    config.channels.results
                ) {

                    const resultsChannel =
                        interaction.guild.channels.cache.get(
                            config.channels.results
                        );

                    if (resultsChannel) {

                        await resultsChannel.send({
                            embeds: [
                                embed
                            ]
                        });
                    }
                }

                return interaction.reply({
                    content:
                        `✅ Resultado da partida #${matchId} registrado.`,
                    flags: 64
                });
            }


            // ==================================================
            // RANKING
            // ==================================================

            if (
                interaction.commandName ===
                "ranking"
            ) {

                const ranking =
                    Object.values(
                        db.players
                    ).sort(
                        (a, b) =>
                            b.points -
                            a.points
                    );

                if (
                    ranking.length === 0
                ) {

                    return interaction.reply({
                        content:
                            "📊 Ainda não existem jogadores no ranking."
                    });
                }

                const rankingText =
                    ranking
                        .slice(0, 10)
                        .map(
                            (player, index) =>
                                `${index + 1}. <@${player.id}> — ${player.points} pontos | ${player.wins} vitórias`
                        )
                        .join("\n");

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🏆 RANKING"
                        )
                        .setDescription(
                            rankingText
                        )
                        .setFooter({
                            text:
                                "ORG Free Fire • Ranking"
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
                            `👤 PERFIL — ${user.username}`
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

        } catch (error) {

            console.error(
                "ERRO NA INTERAÇÃO:",
                error
            );

            try {

                if (
                    interaction.deferred ||
                    interaction.replied
                ) {

                    await interaction.editReply({
                        content:
                            "❌ Ocorreu um erro ao executar o comando."
                    });

                } else {

                    await interaction.reply({
                        content:
                            "❌ Ocorreu um erro ao executar o comando.",
                        flags: 64
                    });
                }

            } catch (replyError) {

                console.error(
                    "ERRO AO RESPONDER:",
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

        await registerCommands();
    }
);


// ======================================================
// SERVIDOR HTTP — RENDER
// ======================================================

const PORT =
    process.env.PORT || 3000;

http.createServer(
    (req, res) => {

        res.writeHead(200);

        res.end(
            "Bot online!"
        );
    }
).listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🌐 Servidor HTTP rodando na porta ${PORT}`
        );
    }
);


// ======================================================
// LOGIN
// ======================================================

client.login(
    config.token
);
