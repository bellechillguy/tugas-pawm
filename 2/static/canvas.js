const canvas = document.querySelector("#shapeCanvas");
const ctx = canvas.getContext("2d");

ctx.textAlign = "center";
ctx.fillStyle = "#222";
ctx.font = "bold 25px Georgia";
ctx.fillText("Nisrina Zakiyah", canvas.width / 2, 42);

// Shape 1: circle
ctx.beginPath();
ctx.arc(canvas.width / 2, 125, 52, 0, Math.PI * 2);
ctx.fillStyle = "#e76f51";
ctx.fill();
ctx.strokeStyle = "#222";
ctx.lineWidth = 3;
ctx.stroke();

// Shape 2: rectangle
ctx.fillStyle = "#2a9d8f";
ctx.fillRect(105, 215, 210, 95);
ctx.strokeRect(105, 215, 210, 95);

// Shape 3: triangle
ctx.beginPath();
ctx.moveTo(canvas.width / 2, 350);
ctx.lineTo(95, 475);
ctx.lineTo(325, 475);
ctx.closePath();
ctx.fillStyle = "#f4a261";
ctx.fill();
ctx.stroke();
