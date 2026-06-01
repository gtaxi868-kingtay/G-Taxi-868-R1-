const fs = require('fs');
const path = require('path');

function createPngBuffer(width, height, r = 0, g = 0, b = 0) {
  const fileSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeInt32BE(width, 0);
  ihdrData.writeInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrChunk = createChunk('IHDR', ihdrData);

  const scanlineLength = width * 3 + 1;
  const rawData = Buffer.alloc(height * scanlineLength);
  for (let y = 0; y < height; y++) {
    rawData[y * scanlineLength] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * scanlineLength + 1 + x * 3;
      rawData[idx] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
    }
  }

  const zlibHeader = Buffer.from([0x78, 0x01]);
  const blocksCount = Math.ceil(rawData.length / 65535);
  const zlibChunks = [];

  for (let i = 0; i < blocksCount; i++) {
    const start = i * 65535;
    const end = Math.min(start + 65535, rawData.length);
    const size = end - start;
    const lastBlock = (i === blocksCount - 1) ? 1 : 0;

    const blockHeader = Buffer.alloc(5);
    blockHeader[0] = lastBlock;
    blockHeader.writeUInt16LE(size, 1);
    blockHeader.writeUInt16LE(~size & 0xFFFF, 3);

    zlibChunks.push(blockHeader, rawData.subarray(start, end));
  }

  let adlerA = 1, adlerB = 0;
  for (let i = 0; i < rawData.length; i++) {
    adlerA = (adlerA + rawData[i]) % 65521;
    adlerB = (adlerB + adlerA) % 65521;
  }
  const adlerBuffer = Buffer.alloc(4);
  adlerBuffer.writeUInt32BE((adlerB * 65536 + adlerA) >>> 0, 0);

  const idatData = Buffer.concat([zlibHeader, ...zlibChunks, adlerBuffer]);
  const idatChunk = createChunk('IDAT', idatData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([fileSignature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

const assetsConfig = [
  { dir: 'apps/admin-mobile/assets', files: [
    { name: 'icon.png', w: 1024, h: 1024 },
    { name: 'adaptive-icon.png', w: 1024, h: 1024 },
    { name: 'splash.png', w: 1242, h: 2436 }
  ]},
  { dir: 'apps/merchant-mobile/assets', files: [
    { name: 'icon.png', w: 1024, h: 1024 },
    { name: 'adaptive-icon.png', w: 1024, h: 1024 },
    { name: 'splash.png', w: 1242, h: 2436 }
  ]}
];

assetsConfig.forEach(target => {
  const fullDir = path.resolve(target.dir);
  fs.mkdirSync(fullDir, { recursive: true });
  target.files.forEach(file => {
    const buffer = createPngBuffer(file.w, file.h, 0, 0, 0);
    const filePath = path.join(fullDir, file.name);
    fs.writeFileSync(filePath, buffer);
    const stats = fs.statSync(filePath);
    console.log(`Created: ${target.dir}/${file.name} (${file.w}x${file.h}, ${stats.size} bytes)`);
  });
});
