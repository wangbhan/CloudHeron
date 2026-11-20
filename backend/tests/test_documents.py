import base64
import io
import zipfile
from types import SimpleNamespace

import pytest
from PIL import Image
from cloudheron.document_parser import parse_document
from cloudheron.provider import Provider
from cloudheron.security import Vault

def sample_docx():
    output=io.BytesIO()
    image=io.BytesIO()
    Image.new('RGB',(30,20),'blue').save(image,format='PNG')
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml','<Types/>')
        archive.writestr('word/document.xml', """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>白鹭飞过蓝色云海</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>服装：白色长袍</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>""")
        archive.writestr('word/_rels/document.xml.rels','<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>')
        archive.writestr('word/media/image1.png',image.getvalue())
    return output.getvalue()


def sample_pdf():
    # Pillow produces an image-only PDF to exercise the scan path.
    output=io.BytesIO()
    Image.new('RGB',(200,100),'blue').save(output,format='PDF')
    return output.getvalue()


def test_docx_text_table_and_embedded_image():
    doc=parse_document(sample_docx(),'story.docx')
    assert len(doc['images'])==1
    assert doc['sections'][0]['image_indices']==[0]
    assert '白鹭' in doc['sections'][0]['text']
    assert any('服装' in section['text'] for section in doc['sections'])
    with Image.open(io.BytesIO(base64.b64decode(doc['images'][0]['data']))) as image:
        assert image.format=='JPEG'


def test_pdf_scanned_page_is_available_for_visual_analysis():
    doc=parse_document(sample_pdf(),'scan.pdf')
    assert len(doc['sections'])==len(doc['images'])==1
    assert doc['sections'][0]['text']==''
    assert doc['sections'][0]['image_indices']==[0]
    with Image.open(io.BytesIO(base64.b64decode(doc['images'][0]['data']))) as image:
        assert image.getpixel((10,10))[2]>200


@pytest.mark.parametrize('data,name',[(b'PKbad archive','x.pdf'),(b'invalid data '*3,'x.doc'),(b'%PDF-broken','x.docx')])
def test_document_format_mismatch_is_rejected(data,name):
    with pytest.raises(ValueError):
        parse_document(data,name)


@pytest.mark.parametrize('style',['openai','responses','claude'])
def test_document_analysis_sends_images_in_each_protocol(style):
    from cloudheron.document_parser import image_record
    image=base64.b64decode(parse_document(sample_docx(),'a.docx')['images'][0]['data'])
    vault=Vault(base64.b64encode(b'k'*32).decode())
    provider=Provider(SimpleNamespace(),vault,SimpleNamespace(read=lambda _:image),None)
    captured=[]
    def request(model,path,method,body,**kwargs):
        captured.append(body)
        if style=='responses':
            return {'output':[{'type':'message','content':[{'type':'output_text','text':'visual summary'}]}]}
        if style=='claude':
            return {'content':[{'type':'text','text':'visual summary'}]}
        return {'choices':[{'message':{'content':'visual summary'}}]}
    provider.request=request
    model={'spec':{'capabilities':['text'],'base_url':'http://fixture/v1','model':'vision','protocol':'OpenAI','text_format':style},'secret':''}
    text=provider.analyze_document(model,{'sections':[{'label':'page1','text':'blue bird','image_indices':[0]}]},[{'file':'a','mime':'image/jpeg'}],{})
    assert text=='visual summary'
    blocks=captured[0]['input' if style=='responses' else 'messages'][-1]['content']
    assert 'blue bird' in blocks[0]['text']
    assert blocks[1]['type']=={'openai':'image_url','responses':'input_image','claude':'image'}[style]
