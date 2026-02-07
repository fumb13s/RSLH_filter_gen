/**
 * File upload module — drag-drop and file picker for .hsf files.
 */

export function initUpload(
  onFileLoaded: (text: string, fileName: string) => void,
  onError: (message: string) => void,
): void {
  const dropZone = document.getElementById("drop-zone")!;
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  const browseBtn = document.getElementById("browse-btn")!;

  // Click-to-browse
  browseBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      readFile(file, onFileLoaded, onError);
      fileInput.value = ""; // allow re-uploading same file
    }
  });

  // Drag-and-drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) {
      readFile(file, onFileLoaded, onError);
    }
  });
}

function readFile(
  file: File,
  onFileLoaded: (text: string, fileName: string) => void,
  onError: (message: string) => void,
): void {
  if (!file.name.endsWith(".hsf")) {
    onError(`Invalid file type: "${file.name}". Please select a .hsf file.`);
    return;
  }
  file.text().then(
    (text) => onFileLoaded(text, file.name),
    (err) => onError(`Failed to read file: ${err}`),
  );
}
