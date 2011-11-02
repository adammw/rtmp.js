/* 
 * rtmp.js - Javascript implementation of RTMPT
 * 
 * Copyright (C) 2011 Adam Malcontenti-Wilson
 * 
 * Based on librtmp, licenced under LGPL.
 */

/* Constants */
const RTMP_CHANNELS	= 65600;

/*    RTMP_PACKET_TYPE_...                = 0x00 */
const RTMP_PACKET_TYPE_CHUNK_SIZE         = 0x01;
/*    RTMP_PACKET_TYPE_...                = 0x02 */
const RTMP_PACKET_TYPE_BYTES_READ_REPORT  = 0x03;
const RTMP_PACKET_TYPE_CONTROL            = 0x04;
const RTMP_PACKET_TYPE_SERVER_BW          = 0x05;
const RTMP_PACKET_TYPE_CLIENT_BW          = 0x06;
/*    RTMP_PACKET_TYPE_...                = 0x07 */
const RTMP_PACKET_TYPE_AUDIO              = 0x08
const RTMP_PACKET_TYPE_VIDEO              = 0x09
/*    RTMP_PACKET_TYPE_...                = 0x0A */
/*    RTMP_PACKET_TYPE_...                = 0x0B */
/*    RTMP_PACKET_TYPE_...                = 0x0C */
/*    RTMP_PACKET_TYPE_...                = 0x0D */
/*    RTMP_PACKET_TYPE_...                = 0x0E */
const RTMP_PACKET_TYPE_FLEX_STREAM_SEND   = 0x0F
const RTMP_PACKET_TYPE_FLEX_SHARED_OBJECT = 0x10
const RTMP_PACKET_TYPE_FLEX_MESSAGE       = 0x11
const RTMP_PACKET_TYPE_INFO               = 0x12
const RTMP_PACKET_TYPE_SHARED_OBJECT      = 0x13
const RTMP_PACKET_TYPE_INVOKE             = 0x14
/*      RTMP_PACKET_TYPE_...              = 0x15 */
const RTMP_PACKET_TYPE_FLASH_VIDEO        = 0x16

const RTMP_MAX_HEADER_SIZE = 18;

const RTMP_PACKET_SIZE_LARGE = 0;
const RTMP_PACKET_SIZE_MEDIUM = 1;
const RTMP_PACKET_SIZE_SMALL = 2;
const RTMP_PACKET_SIZE_MINIMUM = 3;

const RTMP_SIG_SIZE = 1536;



/* Main Library constructor */
RTMP = function(rtmpUrl) {
    //TODO Parse url
    
    this.hostname = 'cp53909.edgefcs.net';
    this.port = 80;

    this.vecChannelsIn = [];
    this.vecChannelsOut = [];
    this.connect();
    this.handshake();
};
RTMP.Log = function(level, message) {
    if (level == "warn") console.warn('WARN:', message);
    else if (level == "err") console.warn('ERR:', message);
    else console.log('DEBUG:', message);
};
RTMP.prototype.connect = function() {
    this.msgCounter = 1;
    this.clientId = this.sendRawPacket("open", "\0" );
    this.msgCounter = 0;
};
RTMP.prototype.handshake = function() {
    // See http://thompsonng.blogspot.com/2010/10/rtmp-part-1.html for clearer explaination of C0,C1,C2,S0,S1,S2
    //TODO: Handshake with CRYPTO

    // Generate client signature(s)
    var clientbuf = new ArrayBuffer(RTMP_SIG_SIZE+1);
    var clientsig = new DataView(clientbuf,1,RTMP_SIG_SIZE);

    (new DataView(clientbuf,0,1)).setUint8(0,0x03); /* C0: 0x03, not encrypted */
    clientsig.setUint32(0, (new Date().valueOf()), false); /* C1: uptime, BE */
    clientsig.setUint32(4, 0x00); /* C1: 4 NULL bytes */
    
    for(var i = 8; i < RTMP_SIG_SIZE; i++) /* C1: fill the rest with random bytes */
        clientsig.setUint8(i,Math.random()*256);

    // Send signature
    var response = this.sendRawPacket("send", clientbuf);
    var type = (new DataView(response,1,1)).getUint8(0); /* S0: 0x03 or 0x06 */
    var serversig = new DataView(response, 2, RTMP_SIG_SIZE); /* S1 */

    // Decode server response
    RTMP.Log("debug", "Type Answer: " + type);

    if (type != 0x03)
        RTMP.Log("warn", "Type mismatch: client sent" + 0x03 + ", server answered " + type);

    var serverUptime = serversig.getUint8(1, false);
    RTMP.Log("debug", "Server Uptime: " + serverUptime);

    // Check second part of handshake, S2
    var serversig = new DataView(response, RTMP_SIG_SIZE+2, RTMP_SIG_SIZE);
    for(var i = 0; i < RTMP_SIG_SIZE; i++) {
        if (serversig.getUint8(i) != clientsig.getUint8(i)) {
            RTMP.Log("warn", "client signature does not match!");
            return false;   
        }
    } 
    
    // Send C2 (Echo back S1)
    this.sendRawPacket("send", response.slice(2, RTMP_SIG_SIZE+2));

    return true;
};
RTMP.prototype.createConnectPacket = function() {
    const RTMP_PACKET_SIZE_LARGE = 0;
    const RTMP_PACKET_TYPE_INVOKE = 0x14;
    const RTMP_MAX_HEADER_SIZE = 18;

    var pkt = new RTMP.Packet();
    pkt.nChannel = 0x03; /* control channel (invoke) */
    pkt.headerType = RTMP_PACKET_SIZE_LARGE;
    pkt.packetType = RTMP_PACKET_TYPE_INVOKE;
    pkt.nTimeStamp = 0;
    pkt.nInfoField2 = 0;
    pkt.hasAbsTimestamp = 0;
    pkt.body = pbuf + RTMP_MAX_HEADER_SIZE;

    //TODO nity-gritty
};
RTMP.prototype.sendPacket = function(packet) {
    if (!packet instanceof RTMP.Packet) throw new Error("sendPacket requires a valid RTMP packet object");
    var last = 0;   
    var prevPacket = this.vecChannelsOut[packet.nChannel];
    if (prevPacket && packet.headerType != RTMP_PACKET_SIZE_LARGE) {
        /* compress a bit by using the prev packet's attributes */
        if (prevPacket.nBodySize == packet.nBodySize
            && prevPacket.packetType == packet.packetType
            && packet.headerType == RTMP_PACKET_SIZE_MEDIUM)
            packet.headerType = RTMP_PACKET_SIZE_SMALL;

        if (prevPacket.nTimeStamp == packet.nTimeStamp
            && packet.headerType == RTMP_PACKET_SIZE_SMALL)
            packet.headerType = RTMP_PACKET_SIZE_MINIMUM;

        last = prevPacket.nTimeStamp;
    } 
    if (packet.headerType > 3) { /* sanity */
        RTMP.Log("err","sanity failed!! trying to send header of type: " + packet.headerType);
        return false;
    }
    var nSize = [ 12, 8, 4, 1 ][packet.headerType];
    var hSize = nSize; 
    var cSize = 0;
    var t= packet.nTimeStamp - last;

    //TODO
    
};
RTMP.prototype.sendRawPacket = function(command, packet, async, callback) {
    var xhr = new XMLHttpRequest();
    var url = "http://" + this.hostname + ":" + this.port + "/" + command + ((this.clientId)?"/"+this.clientId:"") + "/" + this.msgCounter;
    console.log(url);
    xhr.open("POST",url,Boolean(async));
    xhr.setRequestHeader("Content-Type","applcation/x-fms");
    if (async) xhr.addEventListener("load", callback);
    if (packet instanceof ArrayBuffer) xhr.responseType = 'arraybuffer';
    xhr.send(packet);
    this.msgCounter++;
    return (!async) ? xhr.response : null;
};
RTMP.Packet = function() {
    
};
