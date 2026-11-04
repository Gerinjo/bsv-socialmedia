import {PDFDocument,rgb} from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import {STORY_ASSETS} from './story-assets.generated.ts';
import {renderTrainerContractPdf,annotateTrainerContractPdf} from '../../../src/trainer-contract-pdf.mjs';
let fonts;
function pdfDependencies(){const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));return fonts??=( {PDFDocument,rgb,fontkit,regularBytes:bytes(STORY_ASSETS.notoSansRegular.base64),boldBytes:bytes(STORY_ASSETS.notoSansBlack.base64)} );}
export async function contractPdf(pages,options){return renderTrainerContractPdf(pages,pdfDependencies(),options);}
export async function annotateContractPdf(base,pages,signatures,options){return annotateTrainerContractPdf(base,pages,signatures,pdfDependencies(),options);}
export async function inspectSignedContract(bytes){const pdf=await PDFDocument.load(bytes,{updateMetadata:false});if(pdf.getPageCount()<1||pdf.getPageCount()>100)throw new Error('Bitte ein vollständiges Vertrags-PDF mit höchstens 100 Seiten hochladen.');return pdf.getPageCount();}

export async function mergeContractPdfs(files){const output=await PDFDocument.create();for(const bytes of files){const input=await PDFDocument.load(bytes,{updateMetadata:false});const pages=await output.copyPages(input,input.getPageIndices());for(const page of pages)output.addPage(page);}return output.save();}
