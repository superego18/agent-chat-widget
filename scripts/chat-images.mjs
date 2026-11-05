import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
function matches(bytes, mime) {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return mime === 'image/gif' && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6));
}

export function createChatImageStore(root) {
  const dir = path.join(root, 'chat-images');
  function get(id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw new Error('사진을 찾지 못했습니다. 다시 첨부해 주세요.');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
    if (!formats[meta.mime]) throw new Error('지원하지 않는 사진 형식입니다.');
    const file = path.join(dir, id + '.' + formats[meta.mime]);
    if (!fs.statSync(file).isFile()) throw new Error('사진을 찾지 못했습니다.');
    const url = '/__uifb/api/chat-images/' + id;
    return { ...meta, id, file, url, thumbnailUrl: url + '?thumbnail=1' };
  }
  return {
    get,
    thumbnail(id) {
      const image = get(id), file = path.join(dir, id + '.thumb.jpg');
      return fs.existsSync(file) ? { file, mime: 'image/jpeg' } : image;
    },
    saveThumbnail(id, bytes) {
      const { file: original, ...image } = get(id);
      if (!bytes.length || bytes.length > 256 * 1024 || !matches(bytes, 'image/jpeg')) throw new Error('미리보기 사진 형식이나 용량을 확인해 주세요.');
      fs.writeFileSync(path.join(dir, id + '.thumb.jpg'), bytes, { flag: 'wx' });
      return image;
    },
    resolve(ids = []) {
      if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('사진은 한 번에 4장까지 첨부할 수 있습니다.');
      return ids.map(id => { const { file, ...meta } = get(id); return { ...meta, localPath: file }; });
    },
    save(bytes, mime, name) {
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('사진은 한 장에 8MB까지 첨부할 수 있습니다.');
      if (!formats[mime] || !matches(bytes, mime)) throw new Error('JPG·PNG·WebP·GIF 사진을 선택해 주세요. HEIC는 JPG로 바꿔 첨부해 주세요.');
      fs.mkdirSync(dir, { recursive: true });
      const id = randomUUID(), file = path.join(dir, id + '.' + formats[mime]);
      const meta = { name: String(name || '사진').replace(/[\r\n\x00-\x1f]/g, '').slice(0, 160), mime, bytes: bytes.length };
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      try { fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta), { flag: 'wx' }); }
      catch (error) { fs.unlinkSync(file); throw error; }
      return { ...meta, id, url: '/__uifb/api/chat-images/' + id };
    },
  };
}
