/** Pré-visualização do PDF gerado, no leitor do próprio browser. */
export function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div className="pdf__preview">
      <iframe src={url} title={`Pré-visualização de ${fileName}`} />
    </div>
  );
}
