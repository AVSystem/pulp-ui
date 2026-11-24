import { gzipSync } from 'node:zlib';

// Minimal package files built in memory for the upload specs: a python wheel, a
// deb and an rpm. Each holds no program, only the metadata a server reads to
// name and index the package, so a spec needs no file from the repository or the
// machine. The name given is the package's own name; a spec passes a name that
// carries its run's prefix so the unit can be found again.

// The typings of Buffer and of the byte arrays that Buffer.concat and zlib take
// disagree about the kind of array buffer; the bytes are the same.
const join = (parts: Buffer[]): Buffer =>
  Buffer.concat(parts as unknown as Uint8Array[]);

const gzip = (data: Buffer): Buffer => gzipSync(Uint8Array.from(data));

// The CRC-32 of a byte string, as a zip archive records it.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};

const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};

interface Entry {
  name: string;
  data: Buffer;
}

// A zip archive that stores its entries uncompressed.
function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const label = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(33),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(label.length),
      u16(0),
      label,
      data,
    ]);
    centrals.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(33),
        u32(checksum),
        u32(data.length),
        u32(data.length),
        u16(label.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        label,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = join(centrals);
  return join([
    ...locals,
    directory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
}

export interface Generated {
  // the file name the browser reports
  fileName: string;
  buffer: Buffer;
}

// A pure python wheel of the given project name.
export function wheel(project: string, version = '1.0'): Generated {
  const module = project.replace(/[-.]+/g, '_').toLowerCase();
  const info = `${module}-${version}.dist-info`;
  const text = (value: string) => Buffer.from(value, 'utf8');
  return {
    fileName: `${module}-${version}-py3-none-any.whl`,
    buffer: zip([
      { name: `${module}/__init__.py`, data: text('\n') },
      {
        name: `${info}/METADATA`,
        data: text(
          `Metadata-Version: 2.1\nName: ${project}\nVersion: ${version}\nSummary: generated test package\n`,
        ),
      },
      {
        name: `${info}/WHEEL`,
        data: text(
          'Wheel-Version: 1.0\nGenerator: generated\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
        ),
      },
      { name: `${info}/RECORD`, data: text('') },
    ]),
  };
}

const pad = (text: string, width: number): Buffer =>
  Buffer.from(text.padEnd(width, ' '), 'latin1');

// A tar archive of regular files.
function tar(files: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, data } of files) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'latin1');
    header.write('0000644\0', 100, 8, 'latin1');
    header.write('0000000\0', 108, 8, 'latin1');
    header.write('0000000\0', 116, 8, 'latin1');
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.write('00000000000\0', 136, 12, 'latin1');
    header.write('        ', 148, 8, 'latin1');
    header.write('0', 156, 1, 'latin1');
    header.write('ustar\0', 257, 6, 'latin1');
    header.write('00', 263, 2, 'latin1');
    let sum = 0;
    for (const byte of header) {
      sum += byte;
    }
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return join(blocks);
}

// An ar archive in the layout of a deb: members are not compressed here.
function ar(members: Entry[]): Buffer {
  const parts: Buffer[] = [Buffer.from('!<arch>\n', 'latin1')];
  for (const { name, data } of members) {
    parts.push(
      pad(name, 16),
      pad('0', 12),
      pad('0', 6),
      pad('0', 6),
      pad('100644', 8),
      pad(String(data.length), 10),
      Buffer.from('`\n', 'latin1'),
      data,
    );
    if (data.length % 2 === 1) {
      parts.push(Buffer.from('\n', 'latin1'));
    }
  }
  return join(parts);
}

// A deb of the given package name that installs nothing.
export function deb(name: string, version = '1.0'): Generated {
  const control = Buffer.from(
    [
      `Package: ${name}`,
      `Version: ${version}`,
      'Architecture: all',
      'Maintainer: Generated <generated@example.invalid>',
      'Installed-Size: 0',
      'Section: misc',
      'Priority: optional',
      'Description: generated test package',
      '',
    ].join('\n'),
  );
  return {
    fileName: `${name}_${version}_all.deb`,
    buffer: ar([
      { name: 'debian-binary', data: Buffer.from('2.0\n') },
      {
        name: 'control.tar.gz',
        data: gzip(tar([{ name: './control', data: control }])),
      },
      { name: 'data.tar.gz', data: gzip(tar([])) },
    ]),
  };
}

// RPM header tag types.
const STRING = 6;
const INT32 = 4;
const I18N_STRING = 9;

interface Tag {
  tag: number;
  type: number;
  value: string | number;
}

// An rpm header structure: the magic, the index of tags in ascending order and
// the data they point at, each integer aligned to its size.
function rpmHeader(tags: Tag[]): Buffer {
  const sorted = [...tags].sort((left, right) => left.tag - right.tag);
  const index: Buffer[] = [];
  const data: Buffer[] = [];
  let size = 0;
  for (const { tag, type, value } of sorted) {
    if (type === INT32 && size % 4 !== 0) {
      const fill = 4 - (size % 4);
      data.push(Buffer.alloc(fill));
      size += fill;
    }
    let bytes: Buffer;
    if (type === INT32) {
      bytes = Buffer.alloc(4);
      bytes.writeUInt32BE(Number(value));
    } else {
      bytes = Buffer.from(`${String(value)}\0`, 'utf8');
    }
    const entry = Buffer.alloc(16);
    entry.writeUInt32BE(tag, 0);
    entry.writeUInt32BE(type, 4);
    entry.writeUInt32BE(size, 8);
    entry.writeUInt32BE(1, 12);
    index.push(entry);
    data.push(bytes);
    size += bytes.length;
  }
  const head = Buffer.alloc(16);
  head.set([0x8e, 0xad, 0xe8, 0x01], 0);
  head.writeUInt32BE(sorted.length, 8);
  head.writeUInt32BE(size, 12);
  return join([head, ...index, ...data]);
}

// A newc cpio archive that holds no file, gzip compressed.
function emptyPayload(): Buffer {
  const name = 'TRAILER!!!\0';
  const fields = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, name.length, 0]
    .map((value) => value.toString(16).toUpperCase().padStart(8, '0'))
    .join('');
  const entry = Buffer.from(`070701${fields}${name}`, 'latin1');
  const padded = join([entry, Buffer.alloc((4 - (entry.length % 4)) % 4)]);
  return gzip(padded);
}

// An rpm of the given package name that installs nothing.
export function rpm(name: string, version = '1.0'): Generated {
  const release = '1';
  const label = `${name}-${version}-${release}`;
  const lead = Buffer.alloc(96);
  lead.set([0xed, 0xab, 0xee, 0xdb, 3, 0], 0);
  lead.writeUInt16BE(0, 6);
  lead.writeUInt16BE(1, 8);
  lead.write(label.slice(0, 65), 10, 66, 'latin1');
  lead.writeUInt16BE(1, 76);
  lead.writeUInt16BE(5, 78);

  const payload = emptyPayload();
  const main = rpmHeader([
    { tag: 1000, type: STRING, value: name },
    { tag: 1001, type: STRING, value: version },
    { tag: 1002, type: STRING, value: release },
    { tag: 1004, type: I18N_STRING, value: 'generated test package' },
    { tag: 1005, type: I18N_STRING, value: 'generated test package' },
    { tag: 1006, type: INT32, value: 1_700_000_000 },
    { tag: 1009, type: INT32, value: 0 },
    { tag: 1014, type: STRING, value: 'MIT' },
    { tag: 1021, type: STRING, value: 'linux' },
    { tag: 1022, type: STRING, value: 'noarch' },
    { tag: 1124, type: STRING, value: 'cpio' },
    { tag: 1125, type: STRING, value: 'gzip' },
    { tag: 1126, type: STRING, value: '9' },
  ]);
  const signature = rpmHeader([
    { tag: 1000, type: INT32, value: main.length + payload.length },
  ]);
  // the signature header is padded so the header after it starts on 8 bytes
  const gap = Buffer.alloc((8 - (signature.length % 8)) % 8);
  return {
    fileName: `${label}.noarch.rpm`,
    buffer: join([lead, signature, gap, main, payload]),
  };
}
