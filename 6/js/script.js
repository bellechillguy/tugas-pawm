const nama = "Nisrina Zakiyah";
const nim = "18224001";

console.log("Nama:", nama);
console.log("NIM:", nim);

const identitas = document.createElement("p");
identitas.textContent = `Nama: ${nama} | NIM: ${nim}`;
document.body.appendChild(identitas);
