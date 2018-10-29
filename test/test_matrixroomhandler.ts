import * as Chai from "chai";
import * as ChaiAsPromised from "chai-as-promised";
import * as Proxyquire from "proxyquire";
import {DiscordBridgeConfig} from "../src/config";
import {MockDiscordClient} from "./mocks/discordclient";
import {PresenceHandler} from "../src/presencehandler";
import {DiscordBot} from "../src/bot";
import {MatrixRoomHandler} from "../src/matrixroomhandler";
import {MockChannel} from "./mocks/channel";
import {MockMember} from "./mocks/member";
import * as Bluebird from "bluebird";
import {MockGuild} from "./mocks/guild";
import {Guild} from "discord.js";
import { Util } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

Chai.use(ChaiAsPromised);
const expect = Chai.expect;

// const DiscordClientFactory = Proxyquire("../src/clientfactory", {
//     "discord.js": { Client: require("./mocks/discordclient").MockDiscordClient },
// }).DiscordClientFactory;

const RoomHandler = (Proxyquire("../src/matrixroomhandler", {
    "./util": {
        Util: {
            DelayedPromise: Util.DelayedPromise,
            GetMxidFromName: () => {
                return "@123456:localhost";
            },
            MsgToArgs: Util.MsgToArgs,
            ParseCommand: Util.ParseCommand,
        },
    },
})).MatrixRoomHandler;

let USERSJOINED = 0;
let USERSKICKED = 0;
let USERSBANNED = 0;
let USERSUNBANNED = 0;
let MESSAGESENT: any = {};

function buildRequest(eventData) {
    if (eventData.unsigned === undefined) {
        eventData.unsigned = {age: 0};
    }
    return {
        getData: () => eventData,
    };
}

function createRH(opts: any = {}) {
    USERSJOINED = 0;
    USERSKICKED = 0;
    USERSBANNED = 0;
    USERSUNBANNED = 0;
    const bridge = {
        getBot: () => {
            return {
                isRemoteUser: (id) => {
                    return id !== undefined && id.startsWith("@_discord_");
                },
            };
        },
        getIntent: () => {
            return {
                ban: async () => { USERSBANNED++; },
                getClient: () => mxClient,
                join: () => { USERSJOINED++; },
                kick: async () => { USERSKICKED++; },
                leave: () => { },
                sendMessage: async (roomId, content) => { MESSAGESENT = content; return content; },
                unban: async () => { USERSUNBANNED++; },
            };
        },
        getRoomStore: () => {
            return {
                removeEntriesByMatrixRoomId: () => {

                },
            };
        },
    };
    const us = {
        EnsureJoin: async () => { },
        OnMemberState: async () => "user_sync_handled",
        OnUpdateUser: async () => { },
    };
    const cs = {
        GetRoomIdsFromChannel: async (chan) => {
            return ["#" + chan.id + ":localhost"];
        },
        OnUpdate: async () => { },
    };
    const bot = {
        ChannelSyncroniser: cs,
        GetBotId: () => "bot12345",
        GetChannelFromRoomId: async (roomid: string) => {
            if (roomid === "!accept:localhost") {
                const guild = new MockGuild("666666");
                const chan = new MockChannel("777777", guild);
                if (opts.createMembers) {
                    chan.members.set("12345", new MockMember("12345", "testuser1"));
                    chan.members.set("54321", new MockMember("54321", "testuser2"));
                    chan.members.set("bot12345", new MockMember("bot12345", "botuser"));
                }
                guild.members = chan.members;
                return chan;
            } else {
                throw new Error("Roomid not found");
            }
        },
        GetGuilds: () => [new MockGuild("123", [])],
        GetIntentFromDiscordMember: () => {
            return bridge.getIntent();
        },
        LookupRoom: async (guildid, discordid) => {
            if (guildid !== "123") {
                throw new Error("Guild not found");
            } else if (discordid !== "456") {
                throw new Error("Channel not found");
            }
            const channel = new MockChannel();
            return {channel, botUser: true };
        },
        ProcessMatrixMsgEvent: async () => "processed",
        ProcessMatrixRedact: async () => "redacted",
        ProcessMatrixStateEvent: async () => "stateevent",
        ThirdpartySearchForChannels: () => {
            return [];
        },
        UserSyncroniser: us,
    };
    const config = new DiscordBridgeConfig();
    config.limits.roomGhostJoinDelay = 0;
    if (opts.disableSS) {
        config.bridge.enableSelfServiceBridging = false;
    } else {
        config.bridge.enableSelfServiceBridging = true;
    }
    const mxClient = {
        getStateEvent: async () => {
            return opts.powerLevels || {};
        },
        joinRoom: async () => {
            USERSJOINED++;
        },
        sendReadReceipt: async () => { },
        setRoomDirectoryVisibilityAppService: async () => { },
    };
    const provisioner = {
        AskBridgePermission: async () => {
            if (opts.denyBridgePermission) {
                throw new Error("The bridge has been declined by the Discord guild");
            }
        },
        BridgeMatrixRoom: () => {
            if (opts.failBridgeMatrix) {
                throw new Error("Test failed matrix bridge");
            }
        },
        UnbridgeRoom: async () => {
            if (opts.failUnbridge) {
                throw new Error("Test failed unbridge");
            }
        },
    };
    const handler = new RoomHandler(bot as any, config, "@botuser:localhost", provisioner as any);
    handler.setBridge(bridge);
    return handler;
}

describe("MatrixRoomHandler", () => {
    describe("OnAliasQueried", () => {
        it("should join successfully", () => {
            const handler = createRH();
            return expect(handler.OnAliasQueried("#accept:localhost", "!accept:localhost")).to.be.fulfilled;
        });
        it("should join successfully and create ghosts", () => {
            const EXPECTEDUSERS = 2;
            const handler = createRH({createMembers: true});
            return handler.OnAliasQueried("#accept:localhost", "!accept:localhost").then(() => {
                expect(USERSJOINED).to.equal(EXPECTEDUSERS);
            });
        });
        it("should not join successfully", () => {
            const handler = createRH();
            return expect(handler.OnAliasQueried("#reject:localhost", "!reject:localhost")).to.be.rejected;
        });
    });
    describe("OnEvent", () => {
        it("should reject old events", () => {
            const AGE = 900001; // 15 * 60 * 1000
            const handler = createRH();
            return expect(handler.OnEvent(
                buildRequest({unsigned: {age: AGE}}), null))
                .to.be.rejectedWith("Event too old");
        });
        it("should reject un-processable events", () => {
            const AGE = 900000; // 15 * 60 * 1000
            const handler = createRH();
            return expect(handler.OnEvent(buildRequest({
                content: {},
                type: "m.potato",
                unsigned: {age: AGE}}), null)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should handle invites", () => {
            const handler = createRH();
            handler.HandleInvite = async (ev) => "invited";
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "invite"},
                type: "m.room.member"}), null)).to.eventually.equal("invited");
        });
        it("should handle own state updates", () => {
            const handler = createRH();
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "join"},
                state_key: "@_discord_12345:localhost",
                type: "m.room.member"}), null)).to.eventually.equal("user_sync_handled");
        });
        it("should pass other member types to state event", () => {
            const handler = createRH();
            handler.HandleInvite = async (ev) => "invited";
            return expect(handler.OnEvent(buildRequest({
                content: {membership: "join"},
                state_key: "@bacon:localhost",
                type: "m.room.member"}), null)).to.eventually.equal("stateevent");
        });
        it("should handle redactions with existing rooms", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: true,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.redaction"}), context)).to.eventually.equal("redacted");
        });
        it("should ignore redactions with no linked room", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                type: "m.room.redaction"}), context)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should process regular messages", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                content: {body: "abc"},
                type: "m.room.message",
            }), context)).to.eventually.equal("processed");
        });
        it("should alert if encryption is turned on", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                room_id: "!accept:localhost",
                type: "m.room.encryption",
            }), context)).to.eventually.be.fulfilled;
        });
        it("should process !discord commands", () => {
            const handler = createRH();
            handler.ProcessCommand = async (ev) => "processedcmd";
            return expect(handler.OnEvent(buildRequest({
                content: {body: "!discord cmd"},
                type: "m.room.message",
            }), null)).to.eventually.equal("processedcmd");
        });
        it("should ignore regular messages with no linked room", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: null,
                },
            };
            return expect(handler.OnEvent(buildRequest({
                content: {body: "abc"},
                type: "m.room.message",
            }), context)).to.be.rejectedWith("Event not processed by bridge");
        });
        it("should process stickers", () => {
            const handler = createRH();
            const context = {
                rooms: {
                    remote: {
                        roomId: "_discord_123_456",
                    },
                },
            };
            return expect(handler.OnEvent(buildRequest({
                content: {
                    body: "abc",
                    url: "mxc://abc",
                },
                type: "m.sticker",
            }), context)).to.eventually.equal("processed");
        });
    });
    describe("HandleInvite", () => {
        it("should accept invite for bot user", () => {
            const handler: any = createRH();
            handler.joinRoom = async () => "joinedroom";
            return expect(handler.HandleInvite({
                state_key: "@botuser:localhost",
            })).to.eventually.be.equal("joinedroom");
        });
        it("should deny invite for other users", () => {
            const handler: any = createRH();
            handler.joinRoom = async () => "joinedroom";
            return expect(handler.HandleInvite({
                state_key: "@user:localhost",
            })).to.eventually.be.equal("stateevent");
        });
    });
    describe("ProcessCommand", () => {
        it("should warn if self service is disabled", async () => {
            const handler: any = createRH({disableSS: true});
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("The owner of this bridge does not permit self-service bridging.");
        });
        it("should warn if user is not powerful enough with defaults", async () => {
            const handler: any = createRH();
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("You do not have the required power level in this room to " +
                "create a bridge to a Discord channel.");
        });
        it("should warn if user is not powerful enough with custom state default", async () => {
            const handler: any = createRH({powerLevels: {
                state_default: 67,
            }});
            await handler.ProcessCommand({
                room_id: "!123:localhost",
            });
            expect(MESSAGESENT.body).equals("You do not have the required power level in this room to " +
                "create a bridge to a Discord channel.");
        });
        it("should allow if user is powerful enough with defaults", async () => {
            const handler: any = createRH({powerLevels: {
                users_default: 60,
            }});
            const evt = await handler.ProcessCommand({
                content: {body: "!discord help"},
                room_id: "!123:localhost",
            });
            expect(evt.body.startsWith("Available commands")).to.be.true;
        });
        it("should allow if user is powerful enough with their own state", async () => {
            const handler: any = createRH({powerLevels: {
                users: {
                 "@user:localhost": 100,
                },
            }});
            const evt = await handler.ProcessCommand({
                content: {body: "!discord help"},
                room_id: "!123:localhost",
                sender: "@user:localhost",
            });
            expect(evt.body.startsWith("Available commands")).to.be.true;
        });
        describe("!discord bridge", () => {
            it("will bridge a new room, and ask for permissions", async () => {
                const handler: any = createRH({powerLevels: {
                        users_default: 100,
                    }});
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("I have bridged this room to your channel");
            });
            it("will fail to bridge if permissions were denied", async () => {
                const handler: any = createRH({
                    denyBridgePermission: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("The bridge has been declined by the Discord guild");
            });
            it("will fail to bridge if permissions were denied", async () => {
                const handler: any = createRH({
                    failBridgeMatrix: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge 123 456"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("There was a problem bridging that channel - has " +
                    "the guild owner approved the bridge?");
            });
            it("will not bridge if a link already exists", async () => {
                const handler: any = createRH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: true }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room is already bridged to a Discord guild.");
            });
            it("will not bridge without required args", async () => {
                const handler: any = createRH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: {}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord bridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).to.contain("Invalid syntax");
            });
        });
        describe("!discord unbridge", () => {
            it("will unbridge", async () => {
                const handler: any = createRH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: true,
                    },
                } }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room has been unbridged");
            });
            it("will not unbridge if a link does not exist", async () => {
                const handler: any = createRH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: undefined }};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room is not bridged.");
            });
            it("will not unbridge non-plumbed rooms", async () => {
                const handler: any = createRH({
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: false,
                    },
                }}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).equals("This room cannot be unbridged.");
            });
            it("will show error if unbridge fails", async () => {
                const handler: any = createRH({
                    failUnbridge: true,
                    powerLevels: {
                        users_default: 100,
                    },
                });
                const context = {rooms: { remote: {
                    data: {
                        plumbed: true,
                    },
                }}};
                const evt = await handler.ProcessCommand({
                    content: {body: "!discord unbridge"},
                    room_id: "!123:localhost",
                }, context);
                expect(evt.body).to.contain("There was an error unbridging this room.");
            });
        });
    });
    describe("OnAliasQuery", () => {
        it("will create room", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123_456:localhost",
                "_discord_123_456")).to.eventually.be.true;
        });
        it("will not create room if guild cannot be found", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_111_456:localhost",
                "_discord_111_456")).to.eventually.be.undefined;
        });
        it("will not create room if channel cannot be found", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123_444:localhost",
                "_discord_123_444")).to.eventually.be.undefined;
        });
        it("will not create room if alias is wrong", () => {
            const handler: any = createRH({});
            handler.createMatrixRoom = () => true;
            return expect(handler.OnAliasQuery(
                "_discord_123:localhost",
                "_discord_123")).to.be.undefined;
        });
    });
    describe("tpGetProtocol", () => {
       it("will return an object", () => {
           const handler: any = createRH({});
           return handler.tpGetProtocol("").then((protocol) => {
               expect(protocol).to.not.be.null;
               expect(protocol.instances[0].network_id).to.equal("123");
               expect(protocol.instances[0].bot_user_id).to.equal("@botuser:localhost");
               expect(protocol.instances[0].desc).to.equal("123");
               expect(protocol.instances[0].network_id).to.equal("123");
           });
       });
    });
    describe("tpGetLocation", () => {
        it("will return an array", () => {
            const handler: any = createRH({});
            return handler.tpGetLocation("", {
                channel_name: "",
                guild_id: "",
            }).then((channels) => {
                expect(channels).to.be.a("array");
            });
        });
    });
    describe("tpParseLocation", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpParseLocation("alias")).to.eventually.be.rejected;
        });
    });
    describe("tpGetUser", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpGetUser("", {})).to.eventually.be.rejected;
        });
    });
    describe("tpParseUser", () => {
        it("will reject", () => {
            const handler: any = createRH({});
            return expect(handler.tpParseUser("alias")).to.eventually.be.rejected;
        });
    });
    describe("joinRoom", () => {
        it("will join immediately", () => {
            const handler: any = createRH({});
            const intent = {
                getClient: () => {
                    return {
                        joinRoom: async () => { },
                    };
                },
            };
            const startTime = Date.now();
            const MAXTIME = 1000;
            return expect(handler.joinRoom(intent, "#test:localhost")).to.eventually.be.fulfilled.and.satisfy(() => {
                return (Date.now() - startTime) < MAXTIME;
            });
        });
        it("will fail first, join after", () => {
            const handler: any = createRH({});
            let shouldFail = true;
            const intent = {
                getClient: () => {
                    return {
                        getUserId: () => "@test:localhost",
                        joinRoom: async () => {
                            if (shouldFail) {
                                shouldFail = false;
                                throw new Error("Test failed first time");
                            }
                        },
                    };
                },
            };
            const startTime = Date.now();
            const MINTIME = 1000;
            return expect(handler.joinRoom(intent, "#test:localhost")).to.eventually.be.fulfilled.and.satisfy(() => {
                expect(shouldFail).to.be.false;
                return (Date.now() - startTime) > MINTIME;
            });
        });
    });
    describe("createMatrixRoom", () => {
        it("will return an object", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123", new MockGuild("456"));
            const roomOpts = handler.createMatrixRoom(channel, "#test:localhost");
            expect(roomOpts.creationOpts).to.exist;
            expect(roomOpts.remote).to.exist;
        });
    });
    describe("HandleDiscordCommand", () => {
        it("will kick a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                content: "!matrix kick someuser",
                member,
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSKICKED).equals(1);
            });
        });
        it("will kick a member in all guild rooms", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel, (new MockChannel("456"))]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                content: "!matrix kick someuser",
                member,
            };
            return handler.HandleDiscordCommand(message).then(() => {
                // tslint:disable-next-line:no-magic-numbers
                expect(USERSKICKED).equals(2);
            });
        });
        it("will deny permission", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return false;
            };
            const message = {
                channel,
                content: "!matrix kick someuser",
                member,
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSKICKED).equals(0);
            });
        });
        it("will ban a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                content: "!matrix ban someuser",
                member,
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSBANNED).equals(1);
            });
        });
        it("will unban a member", () => {
            const handler: any = createRH({});
            const channel = new MockChannel("123");
            const guild = new MockGuild("456", [channel]);
            channel.guild = guild;
            const member: any = new MockMember("123456", "blah");
            member.hasPermission = () => {
                return true;
            };
            const message = {
                channel,
                content: "!matrix unban someuser",
                member,
            };
            return handler.HandleDiscordCommand(message).then(() => {
                expect(USERSUNBANNED).equals(1);
            });
        });
    });
});
