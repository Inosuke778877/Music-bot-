const { SlashCommandBuilder, EmbedBuilder } = require('@discordjs/builders');
const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Riffy } = require('riffy');
const { Classic } = require('musicard');
const { getLyrics } = require('genius-lyrics-api');
const fs = require('fs').promises;
const path = require('path');

class MusicCog {
    constructor(client) {
        this.client = client;
        this.riffy = new Riffy(client, [{
            host: "localhost",
            password: "youshallnotpass",
            port: 2333,
            secure: false,
            name: "Main Node"
        }], {
            send: (payload) => {
                const guild = client.guilds.cache.get(payload.d.guild_id);
                if (guild) guild.shard.send(payload);
            },
            defaultSearchPlatform: "ytmsearch",
            restVersion: "v4",
            spotify: {
                clientId: process.env.SPOTIFY_CLIENT_ID,
                clientSecret: process.env.SPOTIFY_CLIENT_SECRET
            }
        });

        // Path for JSON playlist storage
        this.playlistFile = path.join(__dirname, 'playlists.json');
        this.ensurePlaylistFile();

        // Initialize Riffy when the client is ready
        client.on('ready', () => {
            this.riffy.init(client.user.id);
            console.log('MusicCog: Riffy initialized');
        });

        // Riffy event handlers
        this.riffy.on("nodeConnect", (node) => {
            console.log(`MusicCog: Node "${node.name}" connected.`);
        });

        this.riffy.on("nodeError", (node, error) => {
            console.error(`MusicCog: Node "${node.name}" error: ${error.message}`);
        });

        this.riffy.on("trackStart", async (player, track) => {
            const channel = client.channels.cache.get(player.textChannel);
            try {
                const musicard = await Classic({
                    thumbnailImage: track.info.thumbnail || 'https://via.placeholder.com/150',
                    backgroundColor: '#070707',
                    progress: 0,
                    progressColor: '#FF7A00',
                    progressBarColor: '#5F2D00',
                    name: track.info.title,
                    nameColor: '#FF7A00',
                    author: track.info.author,
                    authorColor: '#696969',
                    startTime: '0:00',
                    endTime: new Date(track.info.length).toISOString().substr(14, 5),
                    timeColor: '#FF7A00',
                });
                await fs.writeFile('musicard.png', musicard);
                await channel.send({
                    content: `Now Playing: **${track.info.title}** by ${track.info.author}`,
                    files: [{ attachment: 'musicard.png', name: 'musicard.png' }]
                });
                await fs.unlink('musicard.png').catch(() => {}); // Clean up
            } catch (error) {
                console.error('Error generating musicard:', error);
                await channel.send(`Now Playing: **${track.info.title}** by ${track.info.author}`);
            }
        });

        this.riffy.on("queueEnd", async (player) => {
            const channel = client.channels.cache.get(player.textChannel);
            await channel.send('Queue has ended.');
            player.destroy();
        });

        client.on("raw", (d) => {
            if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(d.t)) return;
            this.riffy.updateVoiceState(d);
        });

        // Button interaction handler for lyrics pagination
        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith('lyrics_')) return;

            const [_, action, userId, pageStr] = interaction.customId.split('_');
            const page = parseInt(pageStr);
            const lyricsData = this.client.lyricsCache?.get(interaction.message.id);

            if (!lyricsData || interaction.user.id !== userId) {
                return interaction.reply({ content: 'This interaction is not for you or has expired.', ephemeral: true });
            }

            let newPage = page;
            if (action === 'prev' && page > 0) newPage--;
            if (action === 'next' && page < lyricsData.chunks.length - 1) newPage++;

            const embed = new EmbedBuilder()
                .setTitle(lyricsData.title)
                .setDescription(lyricsData.chunks[newPage] || 'No lyrics available.')
                .setColor(0xFF7A00)
                .setFooter({ text: `Page ${newPage + 1} of ${lyricsData.chunks.length}` })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`lyrics_prev_${userId}_${newPage}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(newPage === 0),
                new ButtonBuilder()
                    .setCustomId(`lyrics_next_${userId}_${newPage}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(newPage === lyricsData.chunks.length - 1)
            );

            await interaction.update({ embeds: [embed], components: [row] });
        });
    }

    // Ensure playlist JSON file exists
    async ensurePlaylistFile() {
        try {
            await fs.access(this.playlistFile);
        } catch {
            await fs.writeFile(this.playlistFile, JSON.stringify({}));
        }
    }

    // Load playlists from JSON
    async loadPlaylists() {
        const data = await fs.readFile(this.playlistFile, 'utf8');
        return JSON.parse(data);
    }

    // Save playlists to JSON
    async savePlaylists(playlists) {
        await fs.writeFile(this.playlistFile, JSON.stringify(playlists, null, 2));
    }

    get commands() {
        return [
            new SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a song or playlist')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or Spotify link')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('pause')
                .setDescription('Pause the current song'),
            new SlashCommandBuilder()
                .setName('skip')
                .setDescription('Skip the current song'),
            new SlashCommandBuilder()
                .setName('stop')
                .setDescription('Stop playback and clear the queue'),
            new SlashCommandBuilder()
                .setName('resume')
                .setDescription('Resume the paused song'),
            new SlashCommandBuilder()
                .setName('queue')
                .setDescription('Show the current music queue'),
            new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show all available music commands'),
            new SlashCommandBuilder()
                .setName('playlist_create')
                .setDescription('Create a new playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_delete')
                .setDescription('Delete a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_add')
                .setDescription('Add a song to a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name, URL, or Spotify link')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_remove')
                .setDescription('Remove a song from a playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('index')
                        .setDescription('Index of the song to remove (1-based)')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('playlist_play')
                .setDescription('Play a saved playlist')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of the playlist')
                        .setRequired(true)),
            new SlashCommandBuilder()
                .setName('filter')
                .setDescription('Apply an audio filter')
                .addStringOption(option =>
                    option.setName('filter')
                        .setDescription('Filter to apply')
                        .setRequired(true)
                        .addChoices(
                            { name: 'None', value: 'none' },
                            { name: 'Bassboost', value: 'bassboost' },
                            { name: 'Nightcore', value: 'nightcore' },
                            { name: 'Vaporwave', value: 'vaporwave' },
                            { name: '8D', value: '8d' },
                            { name: 'Karaoke', value: 'karaoke' },
                            { name: 'Tremolo', value: 'tremolo' },
                            { name: 'Vibrato', value: 'vibrato' },
                            { name: 'Rotation', value: 'rotation' },
                            { name: 'Distortion', value: 'distortion' },
                            { name: 'Channel Mix', value: 'channelmix' },
                            { name: 'Low Pass', value: 'lowpass' },
                            { name: 'Slowmode', value: 'slowmode' }
                        )),
            new SlashCommandBuilder()
                .setName('lyrics')
                .setDescription('Fetch lyrics for the current song or a specified song')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Song name to search for lyrics (optional)')
                        .setRequired(false))
        ];
    }

    async execute(interaction) {
        const commandName = interaction.commandName;
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        // Check if user is in a voice channel for commands requiring it
        if (!voiceChannel && !['queue', 'help', 'playlist_create', 'playlist_delete', 'playlist_add', 'playlist_remove', 'lyrics'].includes(commandName)) {
            return interaction.reply({
                content: 'You need to be in a voice channel to use this command!',
                ephemeral: true
            });
        }

        // Check bot permissions for voice-related commands
        if (!['queue', 'help', 'playlist_create', 'playlist_delete', 'playlist_add', 'playlist_remove', 'lyrics'].includes(commandName) && !voiceChannel.permissionsFor(interaction.guild.members.me).has([
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
        ])) {
            return interaction.reply({
                content: 'I need permissions to join and speak in your voice channel!',
                ephemeral: true
            });
        }

        // Handle commands
        if (commandName === 'play') {
            await interaction.deferReply();
            const query = interaction.options.getString('query');
            
            const player = this.riffy.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: true
            });

            const resolve = await this.riffy.resolve({ query, requester: interaction.user });
            const { loadType, tracks, playlistInfo } = resolve;

            if (loadType === 'empty') {
                return interaction.followUp('No results found for your query.');
            }

            if (loadType === 'playlist') {
                for (const track of tracks) {
                    track.info.requester = interaction.user;
                    player.queue.add(track);
                }
                await interaction.followUp(`Added playlist **${playlistInfo.name}** with ${tracks.length} tracks.`);
            } else if (loadType === 'track' || loadType === 'search') {
                const track = tracks.shift();
                track.info.requester = interaction.user;
                player.queue.add(track);
                await interaction.followUp(`Added **${track.info.title}** to the queue.`);
            }

            if (!player.playing && !player.paused) player.play();
        }

        else if (commandName === 'pause') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) {
                return interaction.reply({
                    content: 'No music is currently playing!',
                    ephemeral: true
                });
            }
            if (player.paused) {
                return interaction.reply({
                    content: 'The player is already paused!',
                    ephemeral: true
                });
            }
            player.pause(true);
            await interaction.reply('Paused the current song.');
        }

        else if (commandName === 'skip') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) {
                return interaction.reply({
                    content: 'No music is playing or no songs in queue to skip!',
                    ephemeral: true
                });
            }
            player.stop();
            await interaction.reply('Skipped the current song.');
        }

        else if (commandName === 'stop') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) {
                return interaction.reply({
                    content: 'No music is currently playing!',
                    ephemeral: true
                });
            }
            player.destroy();
            await interaction.reply('Stopped playback and cleared the queue.');
        }

        else if (commandName === 'resume') {
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player) {
                return interaction.reply({
                    content: 'No music is currently playing!',
                    ephemeral: true
                });
            }
            if (!player.paused) {
                return interaction.reply({
                    content: 'The player is not paused!',
                    ephemeral: true
                });
            }
            player.pause(false);
            await interaction.reply('Resumed the current song.');
        }

        else if (commandName === 'queue') {
            await interaction.deferReply();
            const player = this.riffy.players.get(interaction.guild.id);
            if (!player || !player.queue.size) {
                return interaction.followUp('No music is playing or the queue is empty.');
            }

            const queueList = player.queue.slice(0, 10).map((track, index) => {
                const duration = new Date(track.info.length).toISOString().substr(14, 5);
                return `${index + 1}. **${track.info.title}** by ${track.info.author} [${duration}]`;
            }).join('\n');

            await interaction.followUp({
                content: `**Current Queue** (Showing up to 10 tracks):\n${queueList || 'No tracks in queue.'}`
            });
        }

        else if (commandName === 'help') {
            await interaction.deferReply();
            const embed = new EmbedBuilder()
                .setTitle('Music Bot Commands')
                .setDescription('List of all available commands and their descriptions.')
                .setColor(0xFF7A00)
                .setTimestamp()
                .setFooter({ text: 'Use /command for specific usage details' });

            this.commands.forEach(cmd => {
                embed.addFields({
                    name: `/${cmd.name}`,
                    value: cmd.description,
                    inline: false
                });
            });

            await interaction.followUp({ embeds: [embed] });
        }

        else if (commandName === 'playlist_create') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId]) playlists[userId] = {};
            if (playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** already exists!`);
            }

            playlists[userId][name] = [];
            await this.savePlaylists(playlists);
            await interaction.followUp(`Created playlist **${name}**.`);
        }

        else if (commandName === 'playlist_delete') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            delete playlists[userId][name];
            await this.savePlaylists(playlists);
            await interaction.followUp(`Deleted playlist **${name}**.`);
        }

        else if (commandName === 'playlist_add') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const query = interaction.options.getString('query');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            const resolve = await this.riffy.resolve({ query, requester: interaction.user });
            if (resolve.loadType === 'empty') {
                return interaction.followUp('No results found for your query.');
            }

            const track = resolve.tracks[0];
            playlists[userId][name].push({
                title: track.info.title,
                author: track.info.author,
                uri: track.info.uri,
                length: track.info.length
            });
            await this.savePlaylists(playlists);
            await interaction.followUp(`Added **${track.info.title}** to playlist **${name}**.`);
        }

        else if (commandName === 'playlist_remove') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const index = interaction.options.getInteger('index') - 1;
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            if (index < 0 || index >= playlists[userId][name].length) {
                return interaction.followUp(`Invalid song index. Use /queue to see the playlist.`);
            }

            const removed = playlists[userId][name][index];
            playlists[userId][name].splice(index, 1);
            await this.savePlaylists(playlists);
            await interaction.followUp(`Removed **${removed.title}** from playlist **${name}**.`);
        }

        else if (commandName === 'playlist_play') {
            await interaction.deferReply();
            const name = interaction.options.getString('name');
            const playlists = await this.loadPlaylists();
            const userId = interaction.user.id;

            if (!playlists[userId] || !playlists[userId][name]) {
                return interaction.followUp(`Playlist **${name}** does not exist!`);
            }

            const player = this.riffy.createConnection({
                guildId: interaction.guild.id,
                voiceChannel: voiceChannel.id,
                textChannel: interaction.channel.id,
                deaf: true
            });

            for (const track of playlists[userId][name]) {
                const resolve = await this.riffy.resolve({ query: track.uri, requester: interaction.user });
                if (resolve.loadType !== 'empty') {
                    const resolvedTrack = resolve.tracks[0];
                    resolvedTrack.info.requester = interaction.user;
                    player.queue.add(resolvedTrack);
                }
            }

            if (!player.playing && !player.paused) player.play();
            await interaction.followUp(`Playing playlist **${name}** with ${playlists[userId][name].length} tracks.`);
        }

        else if (commandName === 'filter') {
            await interaction.deferReply();
            const filter = interaction.options.getString('filter');
            const player = this.riffy.players.get(interaction.guild.id);

            if (!player) {
                return interaction.reply({
                    content: 'No music is currently playing!',
                    ephemeral: true
                });
            }

            const filters = {
                none: () => player.filters.clearFilters(),
                bassboost: () => player.filters.setBassboost(true, { value: 3 }),
                nightcore: () => player.filters.setNightcore(true, { rate: 1.5 }),
                vaporwave: () => player.filters.setVaporwave(true, { pitch: 0.5 }),
                '8d': () => player.filters.set8D(true, { rotationHz: 0.2 }),
                karaoke: () => player.filters.setKaraoke(true, { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
                tremolo: () => player.filters.setTremolo(true, { frequency: 2, depth: 0.5 }),
                vibrato: () => player.filters.setVibrato(true, { frequency: 4, depth: 0.5 }),
                rotation: () => player.filters.setRotation(true, { rotationHz: 0.2 }),
                distortion: () => player.filters.setDistortion(true, { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1 }),
                channelmix: () => player.filters.setChannelMix(true, { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 }),
                lowpass: () => player.filters.setLowPass(true, { smoothing: 20 }),
                slowmode: () => player.filters.setSlowmode(true, { rate: 0.8 })
            };

            if (!filters[filter]) {
                return interaction.followUp({
                    content: 'Invalid filter. Available filters: none, bassboost, nightcore, vaporwave, 8d, karaoke, tremolo, vibrato, rotation, distortion, channelmix, lowpass, slowmode',
                    ephemeral: true
                });
            }

            filters[filter]();
            await interaction.followUp(`Applied **${filter === 'none' ? 'no' : filter}** filter.`);
        }

        else if (commandName === 'lyrics') {
            await interaction.deferReply();
            const query = interaction.options.getString('query');
            const player = this.riffy.players.get(interaction.guild.id);

            let title, artist;
            if (query) {
                title = query;
                artist = '';
            } else if (player && player.current) {
                title = player.current.info.title;
                artist = player.current.info.author;
            } else {
                return interaction.followUp({
                    content: 'No song is currently playing, and no query was provided.',
                    ephemeral: true
                });
            }

            try {
                const lyrics = await getLyrics({
                    title,
                    artist,
                    apiKey: process.env.GENIUS_API_KEY,
                    optimizeQuery: true
                });

                if (!lyrics) {
                    return interaction.followUp({
                        content: 'No lyrics found for this song.',
                        ephemeral: true
                    });
                }

                // Split lyrics into 4000-char chunks (Discord embed description limit)
                const chunks = lyrics.match(/(.|[\r\n]){1,4000}/g) || ['No lyrics available.'];
                const embed = new EmbedBuilder()
                    .setTitle(`Lyrics for ${title}${artist ? ` by ${artist}` : ''}`)
                    .setDescription(chunks[0])
                    .setColor(0xFF7A00)
                    .setFooter({ text: `Page 1 of ${chunks.length}` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`lyrics_prev_${interaction.user.id}_0`)
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`lyrics_next_${interaction.user.id}_0`)
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(chunks.length === 1)
                );

                // Store lyrics data in a cache (use a Map on the client)
                if (!this.client.lyricsCache) this.client.lyricsCache = new Map();
                this.client.lyricsCache.set(interaction.id, { chunks, title, artist });

                await interaction.followUp({ embeds: [embed], components: [row] });

                // Clean up cache after 5 minutes
                setTimeout(() => this.client.lyricsCache.delete(interaction.id), 5 * 60 * 1000);
            } catch (error) {
                console.error('Error fetching lyrics:', error);
                await interaction.followUp({
                    content: 'Error fetching lyrics. Please try again later.',
                    ephemeral: true
                });
            }
        }
    }
}

module.exports = MusicCog;