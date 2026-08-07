export function formatPrice(priceStr: string, currency: string = 'USD'): string {
    if (!priceStr || priceStr === 'Free' || currency === 'Free') return 'Free';
    
    // Fallback if price still has text in it (e.g. old data)
    const num = parseInt(priceStr.replace(/[^0-9]/g, ''), 10);
    if (isNaN(num)) return priceStr;

    if (currency === 'KRW') {
        return `₩${num.toLocaleString()}`;
    } else {
        return `$${num.toLocaleString()}`;
    }
}
