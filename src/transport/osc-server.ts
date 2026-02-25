import dgram from "node:dgram";
import type { ActMessage } from "../types.js";

export interface OscMessage {
  address: string;
  args: (string | number)[];
}

type QualityHandler = (
  dancerId: string,
  quality: string,
  value: number
) => void;
type GestureHandler = (dancerId: string, gesture: string) => void;

/**
 * Minimal OSC server using raw UDP.
 *
 * Listens for:
 *   /ralf/quality/<dancerId>/<qualityName> <float>
 *   /ralf/gesture/<dancerId> <string>
 *
 * Sends:
 *   /ralf/act/* messages to the configured output port.
 */
export class OscServer {
  private socket: dgram.Socket;
  private outPort: number;
  private onQuality: QualityHandler | null = null;
  private onGesture: GestureHandler | null = null;

  constructor(
    private listenPort: number,
    outPort: number
  ) {
    this.outPort = outPort;
    this.socket = dgram.createSocket("udp4");
  }

  setQualityHandler(handler: QualityHandler) {
    this.onQuality = handler;
  }

  setGestureHandler(handler: GestureHandler) {
    this.onGesture = handler;
  }

  start() {
    this.socket.on("message", (buf) => {
      const msg = this.parseOsc(buf);
      if (!msg) return;
      this.route(msg);
    });

    this.socket.bind(this.listenPort, () => {
      console.log(`OSC listening on port ${this.listenPort}`);
    });
  }

  send(msg: ActMessage) {
    const buf = this.encodeOsc(msg.address, msg.args);
    this.socket.send(buf, this.outPort, "127.0.0.1");
  }

  stop() {
    this.socket.close();
  }

  private route(msg: OscMessage) {
    const parts = msg.address.split("/").filter(Boolean);
    // /ralf/quality/<dancerId>/<quality>
    if (parts[0] === "ralf" && parts[1] === "quality" && parts.length === 4) {
      const dancerId = parts[2];
      const quality = parts[3];
      const value = typeof msg.args[0] === "number" ? msg.args[0] : 0;
      this.onQuality?.(dancerId, quality, value);
    }
    // /ralf/gesture/<dancerId>
    else if (
      parts[0] === "ralf" &&
      parts[1] === "gesture" &&
      parts.length === 3
    ) {
      const dancerId = parts[2];
      const gesture =
        typeof msg.args[0] === "string" ? msg.args[0] : String(msg.args[0]);
      this.onGesture?.(dancerId, gesture);
    }
  }

  // Minimal OSC parser — handles ,f (float) and ,s (string) type tags
  private parseOsc(buf: Buffer): OscMessage | null {
    try {
      // Address string (null-terminated, padded to 4 bytes)
      let i = 0;
      const addrEnd = buf.indexOf(0, i);
      if (addrEnd === -1) return null;
      const address = buf.toString("ascii", i, addrEnd);
      i = this.pad4(addrEnd + 1);

      // Type tag string
      if (i >= buf.length || buf[i] !== 0x2c) return { address, args: [] }; // no type tag = no args
      const tagEnd = buf.indexOf(0, i);
      if (tagEnd === -1) return { address, args: [] };
      const tags = buf.toString("ascii", i + 1, tagEnd); // skip the ','
      i = this.pad4(tagEnd + 1);

      const args: (string | number)[] = [];
      for (const tag of tags) {
        if (tag === "f") {
          args.push(buf.readFloatBE(i));
          i += 4;
        } else if (tag === "i") {
          args.push(buf.readInt32BE(i));
          i += 4;
        } else if (tag === "s") {
          const sEnd = buf.indexOf(0, i);
          args.push(buf.toString("ascii", i, sEnd));
          i = this.pad4(sEnd + 1);
        }
      }

      return { address, args };
    } catch {
      return null;
    }
  }

  private encodeOsc(address: string, args: (string | number)[]): Buffer {
    const parts: Buffer[] = [];

    // Address
    parts.push(this.oscString(address));

    // Type tags
    let tags = ",";
    for (const a of args) {
      tags += typeof a === "number" ? "f" : "s";
    }
    parts.push(this.oscString(tags));

    // Args
    for (const a of args) {
      if (typeof a === "number") {
        const b = Buffer.alloc(4);
        b.writeFloatBE(a, 0);
        parts.push(b);
      } else {
        parts.push(this.oscString(a));
      }
    }

    return Buffer.concat(parts);
  }

  private oscString(s: string): Buffer {
    const len = s.length + 1; // null terminator
    const padded = Math.ceil(len / 4) * 4;
    const buf = Buffer.alloc(padded);
    buf.write(s, "ascii");
    return buf;
  }

  private pad4(n: number): number {
    return Math.ceil(n / 4) * 4;
  }
}
