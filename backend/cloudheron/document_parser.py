"""Bounded document extraction. Uploads invoke this module in a separate process."""
import base64
import io
import json
import posixpath
import sys
import warnings
import zipfile
from xml.etree import ElementTree as ET

from PIL import Image

MAX_BYTES = 20 * 1024 * 1024
MAX_VISUALS = 12
MAX_TEXT = 60000
Image.MAX_IMAGE_PIXELS = 20_000_000


def image_record(data, label):
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as picture:
            picture.load()
            picture.thumbnail((1400, 1400))
            with picture.convert('RGB') as rgb:
                output = io.BytesIO()
                rgb.save(output, format='JPEG', quality=88)
    return {'label': label, 'data': base64.b64encode(output.getvalue()).decode()}


def parse_pdf(data):
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(data)
    try:
        if not 1 <= len(document) <= MAX_VISUALS:
            raise ValueError('PDF 首批支持 1–12 页，请拆分后上传')
        sections, images = [], []
        for index in range(len(document)):
            page = document[index]
            try:
                width, height = page.get_size()
                if not 0 < min(width, height) <= max(width, height) < 100000:
                    raise ValueError('PDF 页面尺寸有误')
                text_page = page.get_textpage()
                try:
                    text = text_page.get_text_range()
                finally:
                    text_page.close()
                bitmap = page.render(scale=min(2, 1400 / max(width, height)))
                try:
                    picture = bitmap.to_pil()
                    buffer = io.BytesIO()
                    picture.save(buffer, format='PNG')
                    picture.close()
                finally:
                    bitmap.close()
                label = f'第 {index + 1} 页'
                images.append(image_record(buffer.getvalue(), label))
                sections.append({'label': label, 'text': text, 'image_indices': [index]})
            finally:
                page.close()
        return {'sections': sections, 'images': images, 'warnings': []}
    finally:
        document.close()


def xml(data):
    if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
        raise ValueError('Word XML 包含不支持的声明')
    return ET.fromstring(data)


def parse_docx(data):
    w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
    r = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    sections, images, notes = [], [], []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(item.file_size for item in entries) > 80 * 1024 * 1024:
            raise ValueError('Word 解压内容超过支持范围')
        if any(item.flag_bits & 1 for item in entries):
            raise ValueError('请上传未加密的 Word 文档')
        body = xml(archive.read('word/document.xml'))
        rels = {}
        if 'word/_rels/document.xml.rels' in archive.namelist():
            for link in xml(archive.read('word/_rels/document.xml.rels')):
                if link.get('TargetMode') == 'External':
                    continue
                path = posixpath.normpath(posixpath.join('word', link.get('Target', '')))
                if path.startswith('word/media/'):
                    rels[link.get('Id')] = path
        used = {}
        for index, paragraph in enumerate(body.iter(w + 'p')):
            text = ''.join(node.text or '' for node in paragraph.iter(w + 't'))
            refs = []
            for drawing in paragraph.iter(a + 'blip'):
                path = rels.get(drawing.get(r + 'embed'))
                if not path:
                    notes.append('一张链接图片未提取，请将其嵌入文档后重试')
                    continue
                if path not in used:
                    if len(images) >= MAX_VISUALS:
                        raise ValueError('Word 首批支持最多 12 张内嵌图片，请拆分文档')
                    try:
                        image = image_record(archive.read(path), f'内嵌图 {len(images) + 1}')
                    except (OSError, ValueError):
                        notes.append('一张图片格式未识别，建议导出 PDF 后上传')
                        continue
                    used[path] = len(images)
                    images.append(image)
                refs.append(used[path])
            if text or refs:
                sections.append({'label': f'段落 {index + 1}', 'text': text, 'image_indices': refs})
        if any(name.startswith(('word/charts/', 'word/diagrams/')) for name in archive.namelist()):
            notes.append('Word 图表和复杂绘图请导出 PDF，以便完整理解版面')
    if not sections:
        raise ValueError('文档没有可解析的正文或图片')
    return {'sections': sections, 'images': images, 'warnings': list(dict.fromkeys(notes))}


def parse_document(data, filename):
    if not 10 <= len(data) <= MAX_BYTES:
        raise ValueError('文档大小须为 10 字节至 20 MB')
    suffix = filename.rsplit('.', 1)[-1].lower()
    if suffix == 'pdf' and data.startswith(b'%PDF-'):
        result = parse_pdf(data)
    elif suffix == 'docx' and data.startswith(b'PK'):
        result = parse_docx(data)
    else:
        raise ValueError('请上传 PDF 或 Word .docx 文档')
    if sum(len(section['text']) for section in result['sections']) > MAX_TEXT:
        raise ValueError('文档文字超过 60000 字，请拆分后上传')
    return result


if __name__ == '__main__':
    try:
        result = {'ok': True, 'document': parse_document(sys.stdin.buffer.read(MAX_BYTES + 1), sys.argv[1])}
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else '文档读取失败，请检查格式、密码或导出为 PDF'
        result = {'ok': False, 'error': message[:300]}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
