"""Server Flask untuk Virtual Lab Kimia Dasar.

Flask hanya merender template. Seluruh perhitungan, state, dan interaksi
simulasi dijalankan di sisi klien melalui static/js/app.js.
"""

from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(debug=True)