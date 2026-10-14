from pathlib import Path

from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def home():
    css_path = Path(app.root_path) / 'static' / 'style.css'
    css_content = f"<style>\n{css_path.read_text(encoding='utf-8')}\n</style>"
    return render_template('index.html', css_content=css_content)

if __name__=='__main__':
    app.run(debug=True)