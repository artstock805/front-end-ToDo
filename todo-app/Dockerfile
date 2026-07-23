# Fly.io 배포용 이미지 (Node 24 내장 node:sqlite 사용)
FROM node:24-slim

WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

ENV NODE_ENV=production
ENV PORT=3456
# SQLite 파일은 영구 볼륨(/data)에 저장 → 재배포해도 데이터 유지
ENV DB_PATH=/data/todo.db

EXPOSE 3456

CMD ["node", "server.js"]
