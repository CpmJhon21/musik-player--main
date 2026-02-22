const express = require('express');
const cors = require('cors');
const apiHandler = require('./api/index');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public')); // Serve file dari folder public

// Route untuk API
app.all('/api/index', (req, res) => {
    apiHandler(req, res);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});