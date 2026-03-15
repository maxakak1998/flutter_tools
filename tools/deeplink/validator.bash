#!/bin/bash

# Màu sắc cho Terminal
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
    echo -e "${YELLOW}Vui lòng nhập domain cần kiểm tra.${NC}"
    echo "Cách dùng: ./validate_deeplink.sh <domain>"
    echo "Ví dụ: ./validate_deeplink.sh team-dev.upc.bet"
    exit 1
fi

echo -e "\n🔍 Bắt đầu kiểm tra Deep Link cho domain: ${YELLOW}$DOMAIN${NC}\n"

# Hàm kiểm tra chung
check_endpoint() {
    local PLATFORM=$1
    local URL=$2
    
    echo -e "--------------------------------------------------"
    echo -e "🍎🤖 Kiểm tra $PLATFORM:"
    echo -e "🔗 URL: $URL"
    
    # Lấy HTTP Status và Content-Type
    HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
    CONTENT_TYPE=$(curl -s -I "$URL" | grep -i "^content-type:" | awk '{print $2}' | tr -d '\r')

    # 1. Kiểm tra HTTP Status
    if [ "$HTTP_RESPONSE" -eq 200 ]; then
        echo -e "✅ HTTP Status: 200 OK"
    else
        echo -e "❌ HTTP Status: $HTTP_RESPONSE (Mong đợi: 200)"
    fi

    # 2. Kiểm tra Content-Type
    if [[ "$CONTENT_TYPE" == *"application/json"* ]]; then
        echo -e "✅ Content-Type: $CONTENT_TYPE"
    else
        echo -e "❌ Content-Type: $CONTENT_TYPE (Mong đợi: application/json)"
    fi

    # 3. Kiểm tra JSON hợp lệ (Dùng python3 tích hợp sẵn trên Mac)
    JSON_BODY=$(curl -s "$URL")
    if echo "$JSON_BODY" | python3 -c "import sys, json; json.load(sys.stdin)" > /dev/null 2>&1; then
        echo -e "✅ Cấu trúc file: JSON hợp lệ"
    else
        echo -e "❌ Cấu trúc file: Lỗi cú pháp JSON (Vui lòng kiểm tra lại dấu phẩy, ngoặc kép...)"
    fi
}

# --- KIỂM TRA APPLE ---
APPLE_URL="https://$DOMAIN/.well-known/apple-app-site-association"
check_endpoint "Apple (Universal Links)" "$APPLE_URL"

# Kiểm tra thêm qua Apple CDN
echo -e "\n☁️  Kiểm tra bộ nhớ đệm của Apple CDN..."
APPLE_CDN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://app-site-association.cdn-apple.com/all/$DOMAIN")
if [ "$APPLE_CDN_STATUS" -eq 200 ]; then
    echo -e "✅ Apple CDN đã cache file thành công."
else
    echo -e "⚠️  Apple CDN Status: $APPLE_CDN_STATUS (Có thể Apple chưa kịp quét hoặc server chặn bot)."
fi

# --- KIỂM TRA GOOGLE ---
GOOGLE_URL="https://$DOMAIN/.well-known/assetlinks.json"
check_endpoint "Google (App Links)" "$GOOGLE_URL"

# Kiểm tra qua Google Digital Asset Links API
echo -e "\n☁️  Kiểm tra qua Google API..."
GOOGLE_API_URL="https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://$DOMAIN&relation=delegate_permission/common.handle_all_urls"
GOOGLE_API_RESPONSE=$(curl -s "$GOOGLE_API_URL")

# Đếm số lượng object trong mảng statements
STATEMENTS_COUNT=$(echo "$GOOGLE_API_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('statements', [])))" 2>/dev/null)

if [ "$STATEMENTS_COUNT" != "0" ] && [ -n "$STATEMENTS_COUNT" ]; then
    echo -e "✅ Google API xác nhận file hợp lệ (Tìm thấy $STATEMENTS_COUNT liên kết)."
else
    echo -e "❌ Google API không tìm thấy liên kết hợp lệ. Kết quả trả về từ Google:"
    echo "$GOOGLE_API_RESPONSE"
fi

echo -e "\n🎉 Hoàn tất kiểm tra!\n"