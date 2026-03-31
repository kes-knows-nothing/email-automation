// 호텔 요금 목업 서버 (port 8080)
const http = require('http');

const MOCK_RATES = {
  default: { regular_price: 180000, discounted_price: 126000 }, // 30% 할인
};

http.createServer((req, res) => {
  const match = req.url.match(/^\/v3\/hotels\/(\d+)\/rooms\/rates$/);
  if(!match || req.method !== 'POST') {
    res.writeHead(404); res.end('Not found'); return;
  }

  const hotelId = match[1];
  const base = MOCK_RATES[hotelId] || MOCK_RATES.default;
  // 호텔마다 약간 다른 가격
  const factor = (parseInt(hotelId) % 5 + 8) / 10;
  const regular    = Math.round(base.regular_price * factor / 1000) * 1000;
  const discounted = Math.round(base.discounted_price * factor / 1000) * 1000;

  const body = JSON.stringify({
    size: 2,
    items: [
      {
        property_id: parseInt(hotelId),
        room_id: 'ROOM_STD',
        name: '스탠다드룸',
        rates: [
          {
            id: 'RATE_001',
            name: '기본 요금',
            regular_price: regular,
            discounted_price: discounted,
            total_price: discounted,
            sale_price: discounted * 0.9,
            currency: 'KRW',
            refundable: true,
            free_refundable: true,
          }
        ]
      },
      {
        property_id: parseInt(hotelId),
        room_id: 'ROOM_DLX',
        name: '디럭스룸',
        rates: [
          {
            id: 'RATE_002',
            name: '디럭스 요금',
            regular_price: Math.round(regular * 1.3 / 1000) * 1000,
            discounted_price: Math.round(discounted * 1.3 / 1000) * 1000,
            total_price: Math.round(discounted * 1.3 / 1000) * 1000,
            sale_price: Math.round(discounted * 1.3 * 0.9 / 1000) * 1000,
            currency: 'KRW',
            refundable: true,
            free_refundable: false,
          }
        ]
      }
    ]
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
  console.log(`[mock] hotel ${hotelId} → ${discounted.toLocaleString()}원 (정상가 ${regular.toLocaleString()}원)`);
}).listen(8080, () => console.log('Mock API running on http://localhost:8080'));
