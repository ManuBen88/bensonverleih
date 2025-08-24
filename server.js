const http = require('http');
const fs = require('fs');
const path = require('path');

const publicDir = __dirname;

function send(res, status, data, type) {
  res.writeHead(status, {'Content-Type': type});
  res.end(data);
}

function serveStatic(req, res) {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(publicDir, filePath);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      send(res, 404, 'Not Found', 'text/plain');
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      const type = ext === '.html' ? 'text/html' : 'text/plain';
      send(res, 200, data, type);
    }
  });
}

const server = http.createServer((req, res) => {
  serveStatic(req, res);
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on port ${port}`));
