import * as yaml from "js-yaml";
import * as fs from "fs";
import * as args from "command-line-args";
import * as usage from "command-line-usage";
import * as readline from "readline";
import * as Bluebird from "bluebird";
import * as process from "process";

import { DiscordClientFactory } from "../src/clientfactory";
import { DiscordBridgeConfig } from "../src/config";
import { DiscordStore } from "../src/store";
import { Log } from "../src/log";
const log = new Log("UserClientTools");
const PUPPETING_DOC_URL = "https://github.com/Half-Shot/matrix-appservice-discord/blob/develop/docs/puppeting.md";

const optionDefinitions = [
    {
        alias: "h",
        description: "Display this usage guide.",
        name: "help",
        type: Boolean,
    },
    {
        alias: "c",
        defaultValue: "config.yaml",
        description: "The AS config file.",
        name: "config",
        type: String,
        typeLabel: "<config.yaml>",
    },
    {
        description: "Add the user to the database.",
        name: "add",
        type: Boolean,
    },
    {
        description: "Remove the user from the database.",
        name: "remove",
        type: Boolean,
    },
];

const options = args(optionDefinitions);
if (options.help || (options.add && options.remove) || !(options.add || options.remove)) {
    /* tslint:disable:no-console */
    console.log(usage([
        {
            content: "A tool to give a user a power level in a bot user controlled room.",
            header: "User Client Tools",
        },
        {
            header: "Options",
            optionList: optionDefinitions,
        },
    ]));
    process.exit(0);
}

const config: DiscordBridgeConfig = yaml.safeLoad(fs.readFileSync(options.config, "utf8"));
const discordstore = new DiscordStore(config.database ? config.database.filename : "discord.db");
discordstore.init().then(() => {
    log.info("Loaded database.");
    handleUI();
}).catch((err) => {
    log.info("Couldn't load database. Cannot continue.");
    log.info("Ensure the bridge is not running while using this command.");
    process.exit(1);
});

function handleUI() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    let userid = null;
    let token = null;

    rl.question("Please enter your UserID ( ex @Half-Shot:half-shot.uk, @username:matrix.org)", (answeru) => {
        userid = answeru;
        if (options.add) {
            rl.question(`
Please enter your Discord Token
(Instructions for this are on ${PUPPETING_DOC_URL})`, (answert) => {
                token = answert;
                rl.close();
                addUserToken(userid, token).then(() => {
                    log.info("Completed successfully");
                    process.exit(0);
                }).catch((err) => {
                    log.info("Failed to add, $s", err);
                    process.exit(1);
                });
            });
        } else if (options.remove) {
            rl.close();
            discordstore.delete_user_token(userid).then(() => {
                log.info("Completed successfully");
                process.exit(0);
            }).catch((err) => {
                log.info("Failed to delete, $s", err);
                process.exit(1);
            });
        }
    });
}

async function addUserToken(userid: string, token: string): Promise<void> {
    const clientFactory = new DiscordClientFactory(discordstore);
    clientFactory.getDiscordId(token).then(async (discordid) => discordstore.add_user_token(userid, discordid, token) );
}
