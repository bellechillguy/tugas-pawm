from pathlib import Path

from flask import Flask, render_template, send_from_directory

app = Flask(__name__)

@app.route('/')

def home():
    css_path = Path(app.root_path) / 'static' / 'css' / 'style.css'
    css_content = f"<style>\n{css_path.read_text(encoding='utf-8')}\n</style>"
    return render_template('index.html', css_content=css_content)

@app.route('/js/script.js')
def script():
    return send_from_directory(Path(app.root_path) / 'js', 'script.js')

if __name__=='__main__':
    app.run(debug=True)