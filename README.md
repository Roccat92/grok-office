# Grok Office

Văn phòng 3D trên hòn đảo nổi (cùng phong cách với [Kitchen Rally](https://roccat92.github.io/kitchen-rally/)) để xem các Grok Bot đang làm gì. Mỗi bot là một nhân vật khối ngồi ở bàn riêng, có bong bóng ghi việc đang làm, màn hình hiển thị task và tiến độ, bảng kanban theo dự án, phòng họp kính cho nhóm chat và góc cà phê.

- Trang chạy thử: https://roccat92.github.io/grok-office/
- Không cần build. Tĩnh hoàn toàn: `index.html`, `office.js`, `status.json`.
- Three.js r160 tải từ CDN unpkg (giống Kitchen Rally).

## Dữ liệu: mức 2 (bán thực)

Trang đọc `./status.json` mỗi 10 giây (có tham số chống cache), so sánh với lần trước rồi chạy hoạt ảnh cho phần thay đổi: bot đi bộ sang phòng họp, ngồi gõ phím, hiện dấu `!` khi bị chặn, ăn mừng khi xong việc.

Đây là dữ liệu do bot tự ghi vào file theo từng mốc việc (bắt đầu, xong, bị chặn...). Nó không phải luồng theo dõi từng giây. Không có API công khai nào của Grok Bot cho phép xem trực tiếp, nên cách này là cách thực tế nhất.

### Cập nhật trạng thái bằng lệnh

```bash
node scripts/update-status.mjs --bot nexa --state working \
  --task "Chỉnh cơ chế di chuyển Kitchen Rally" --project kitchen-rally --push
```

Script không cần cài thư viện (Node 18+). Các tuỳ chọn chính:

| Tuỳ chọn | Ý nghĩa |
| --- | --- |
| `--bot <id>` | id bot, bắt buộc. Bot chưa có sẽ được tạo mới (thêm `--name`, `--role`, `--color #rrggbb`) |
| `--state` | `working`, `idle`, `meeting`, `blocked`, `done` |
| `--task "..."` | mô tả ngắn việc đang làm |
| `--project` | tên dự án (hiện trên bảng kanban). `""` để bỏ |
| `--room` | `desk` hoặc `meeting` (state `meeting` tự đưa bot vào phòng họp) |
| `--progress` | 0-100, hoặc `none` để bỏ |
| `--log "..."` | thêm một dòng nhật ký. Mặc định tự ghi khi đổi state hoặc task, `--no-log` để tắt. Chỉ giữ 5 dòng cuối |
| `--group <id>` | tạo hoặc sửa nhóm, kèm `--group-name`, `--members a,b`, `--topic`, `--active true/false` |
| `--push` | `git add` + `commit` + `push` status.json (GitHub Pages tự cập nhật sau khoảng 1 phút) |
| `--dry-run` | chỉ in JSON kết quả, không ghi file |
| `--list` | liệt kê bot hiện có |
| `--remove` | xoá bot (kèm `--bot`) |

Ví dụ khác:

```bash
# bot xong việc
node scripts/update-status.mjs --bot nexa --state done --task "Đã đẩy bản sửa di chuyển" --push
# bị chặn
node scripts/update-status.mjs --bot nexa --state blocked --task "Chờ bạn xác nhận cảm giác di chuyển" --push
# kéo cả nhóm vào phòng họp
node scripts/update-status.mjs --group game-casual-pixel --active true --push
# thêm bot mới
node scripts/update-status.mjs --bot kaede --name Kaede --role "Thiết kế" --color "#2fb59a" --push
```

Lưu ý: mỗi lần `--push` là một commit nên tốn thêm credit của bot. Hãy cập nhật theo mốc việc, đừng cập nhật liên tục.

### Cấu trúc status.json (version 1)

```json
{
  "version": 1,
  "updatedAt": "2026-11-01T00:45:00+07:00",
  "bots": [
    {
      "id": "nexa",
      "name": "NEXA",
      "role": "Dev chính",
      "color": "#d94a3d",
      "state": "working",
      "task": "Chỉnh cơ chế di chuyển Kitchen Rally",
      "project": "kitchen-rally",
      "room": "desk",
      "progress": 40,
      "since": "2026-11-01T00:36:00+07:00",
      "log": [{ "t": "2026-11-01T00:36:00+07:00", "msg": "Bắt đầu sửa cơ chế di chuyển" }]
    }
  ],
  "groups": [
    { "id": "game-casual-pixel", "name": "Game casual pixel", "members": ["nexa", "devhub"], "topic": "Kitchen Rally pickleball", "active": false }
  ]
}
```

- `state`: `working` (gõ phím, màn hình sáng), `idle` (ngủ gục tại bàn riêng, có chữ Z z z bay lên, bong bóng "Đang ngủ zzz"), `meeting` (sang phòng họp ngồi), `blocked` (bong bóng đỏ `!`), `done` (ăn mừng rồi nghỉ, thỉnh thoảng ra góc cà phê - mỗi người một chỗ đứng riêng).

Chống chồng chéo (tối đa 8 bot): mỗi bot một bàn riêng, 3 chỗ đứng riêng ở quầy cà phê, bot vào văn phòng lần lượt cách nhau ~1.4 giây, khi đi lại các nhân vật tự né nhau (khoảng cách tối thiểu 1.0), bong bóng tự xếp lệch/chồng lên cao để không đè nhau. Kiểm tra: `node tests/crowd.cjs` (8 bot, cần `node tests/serve.cjs` đang chạy).
- `room`: `desk` hoặc `meeting`. Bot ở phòng họp khi `state` là `meeting`, khi `room` là `meeting`, hoặc khi là thành viên của một nhóm có `"active": true` (trừ khi đang `blocked`).
- `progress` (tuỳ chọn, 0-100): thanh tiến độ trên màn hình, bong bóng và panel.
- `log`: tối đa 5 dòng, dòng mới nhất ở cuối.
- `groups[].active` (tuỳ chọn, mặc định `false`): `true` thì cả nhóm vào phòng họp.
- Tối đa 8 bot có bàn. Bot thứ 9 trở đi bị bỏ qua.

## Đọc dữ liệu từ nguồn khác: `?src=`

Dùng tham số `src` để trỏ trang sang một URL JSON khác (cùng schema), ví dụ khi nối với DevHub:

```
https://roccat92.github.io/grok-office/?src=https://devhub.example.com/api/status.json
```

- Nguồn phải bật CORS (`Access-Control-Allow-Origin`) nếu khác domain. `raw.githubusercontent.com` đã bật sẵn nhưng cache khoảng 5 phút.
- Có thể dùng đường dẫn tương đối, ví dụ `?src=/tests/fixtures/states.json`.
- `?interval=<giây>` đổi chu kỳ đọc (tối thiểu 2 giây, mặc định 10).
- Trang tự thêm `_=<timestamp>` vào URL để tránh cache.

## Giao diện

- Bấm vào bot (trên cảnh, trên bong bóng hoặc trong panel) để zoom camera và mở thẻ chi tiết. Nút "TOÀN CẢNH" để quay lại.
- Chấm kết nối: xanh là ổn, vàng là dữ liệu cũ hơn 60 giây, đỏ là lỗi tải.
- Thời gian hiển thị theo giờ Asia/Bangkok.
- Hỗ trợ điện thoại: panel thành thanh trượt phía dưới, bấm mũi tên để thu gọn.

## Chạy cục bộ

```bash
node tests/serve.cjs 8123   # rồi mở http://localhost:8123
```

Phải chạy qua server tĩnh vì dùng ES module (mở thẳng file:// có thể bị chặn).

## Triển khai

GitHub Pages từ nhánh `main`, thư mục gốc. Mỗi lần push, Pages mất khoảng 30-60 giây để cập nhật, cộng thêm cache CDN vài phút nên có độ trễ.

## Hạn chế đã biết

- Dữ liệu cập nhật theo mốc việc chứ không theo từng giây.
- Cần Internet để tải Three.js từ unpkg.
- Bubble có thể chồng lên nhau khi nhiều bot đứng gần nhau (đã tự đẩy lên, và rút gọn trong phòng họp).
- Chưa có người dùng thật kiểm tra hiệu năng trên máy yếu. Thử nghiệm headless chạy bằng phần mềm nên chậm hơn thật.
