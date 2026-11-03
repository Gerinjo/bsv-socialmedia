import {PDFDocument,rgb} from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import {STORY_ASSETS} from './story-assets.generated.ts';
import {renderTrainerContractPdf} from '../../../src/trainer-contract-pdf.mjs';
export async function contractPdf(pages,options){const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));return renderTrainerContractPdf(pages,{PDFDocument,rgb,fontkit,regularBytes:bytes(STORY_ASSETS.notoSansRegular.base64),boldBytes:bytes(STORY_ASSETS.notoSansBlack.base64)},options);}
export async function inspectSignedContract(bytes){const pdf=await PDFDocument.load(bytes,{updateMetadata:false});if(pdf.getPageCount()<1||pdf.getPageCount()>100)throw new Error('Bitte ein vollständiges Vertrags-PDF mit höchstens 100 Seiten hochladen.');return pdf.getPageCount();}
