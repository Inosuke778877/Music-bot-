const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord.js');
const MusicCog = require('./cogs/music.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
const musicCog = new MusicCog(client);

// Register slash commands
const commands = musicCog.commands.map(command => command.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
})();

// Handle interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    try {
        await musicCog.execute(interaction);
    } catch (error) {
        console.error('Error executing command:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: 'An error occurred while executing the command.', ephemeral: true });
        }
    }
});

// Bot ready event
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Error handling for client
client.on('error', error => {
    console.error('Client error:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);