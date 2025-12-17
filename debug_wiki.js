const axios = require('axios');

async function test() {
    const query = 'Yellowstone';
    console.log('Testing query:', query);

    try {
        let searchTerm = query;
        const openSearchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(searchTerm)}&limit=5&namespace=0&format=json`;
        console.log('Fetching:', openSearchUrl);

        const openRes = await axios.get(openSearchUrl);
        const titles = openRes.data[1];
        console.log('Titles:', titles);

        if (!titles || titles.length === 0) {
            if (!searchTerm.toLowerCase().includes('park') && !searchTerm.toLowerCase().includes('reserve')) {
                 const retryTerm = searchTerm + ' National Park';
                 console.log('Retrying with:', retryTerm);
                 const retryUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(retryTerm)}&limit=5&namespace=0&format=json`;
                 const retryRes = await axios.get(retryUrl);
                 console.log('Retry Titles:', retryRes.data[1]);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

test();
