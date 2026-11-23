// Runs in a dedicated child process with a bounded JS heap and no service keys.
// Its parent enforces the deadline and contains native PDF.js/canvas crashes.
async function extract(bytes:Uint8Array){
  const {PDFParse}=await import('pdf-parse');
  const parser=new PDFParse({data:new Uint8Array(bytes)});
  try {
    const result=await parser.getText();
    if(result.total>200||result.pages.some((page:any)=>page.text.trim().length<10))throw new Error('PDF_REQUIRES_TEXT');
    return result.pages.map((page:any)=>({page:page.num,text:page.text}));
  } finally {await parser.destroy();}
}
function reply(value:object){if(process.send)process.send(value,undefined,undefined,()=>{if(process.connected)process.disconnect();});}
process.once('message',(bytes:Uint8Array)=>{void extract(bytes).then(reply,()=>reply({error:'UNSUPPORTED_PDF'}));});
