# Grok Office

Văn phòng 3D là một tầng của tòa nhà cao tầng giữa thành phố (tầng 5, phía dưới là mặt tiền tòa nhà và đường phố) (cùng phong cách với [Kitchen Rally](https://roccat92.github.io/kitchen-rally/)) để xem các Grok Bot đang làm gì. Mỗi bot là một nhân vật khối ngồi ở bàn riêng, có bong bóng ghi việc đang làm, màn hình hiển thị task và tiến độ, bảng kanban theo dự án, phòng họp kính cho nhóm chat và góc cà phê.

- Trang chạy thử: https://roccat92.github.io/grok-office/
- Không cần build. Tĩnh hoàn toàn: `index.html`, `office.js`, `status.json`.
- Three.js r160 tải từ CDN unpkg (giống Kitchen Rally).

## Nối với DevHub (agent Claude Code, Codex, Grok Build, Grok API, OpenRouter)

Office có 10 bàn: 5 cho Grok Bot và 5 cho các agent có sẵn trong [nexa-devhub](https://github.com/Roccat92/nexa-devhub) (id trong DevHub: `claude`, `codex`, `grok-build`, `grok`, `openrouter`). Agent DevHub có ăng-ten vàng, kính che mắt và huy hiệu ở ngực, hiện chip `DevHub` trong danh sách. Trạng thái lấy từ DevHub, nếu không có thì vẫn chạy bằng `status.json`.

```
daemon DevHub --(script chỉ-đọc trên máy host)--> devhub-status.json  --> Office (poll 10 giây)
```

Daemon DevHub bắt đăng nhập và chạy trên máy của bạn, còn GitHub Pages là trang tĩnh, nên giữa hai bên cần bộ xuất `scripts/export-office-status.mjs` (nằm trong nexa-devhub, nhánh `feat/grok-office-export`, xem `docs/GROK-OFFICE.md` ở đó). Có hai cách nối:

| Cách | Lệnh trên máy host DevHub | Office đọc từ |
| --- | --- | --- |
| A. Đẩy lên repo | `node scripts/export-office-status.mjs --watch 20 --push D:\grok-office` (đặt `NEXA_CODE` trước) | `./devhub-status.json` (mặc định, không cần tham số) |
| B. Trực tiếp | `node scripts/export-office-status.mjs --serve 4318` | thêm `?devhub=http://127.0.0.1:4318/office-status.json` vào URL (qua Tailscale: dùng URL https của `tailscale serve`) |

Tham số URL: `?devhub=URL` đổi nguồn, `?devhub=off` tắt hẳn, `?dhstale=SỐ_GIÂY` đổi ngưỡng coi dữ liệu là cũ (mặc định 300).

Quy tắc hiển thị (thanh trên cùng có chip `DevHub: ...` cho biết đang ở trạng thái nào):

| DevHub báo | Office | Chip trên cùng |
| --- | --- | --- |
| task đang chạy (`running`) | Ngồi gõ phím, hiện tên task và dự án | `trực tiếp` |
| chờ bạn duyệt (`waiting`) | Bị chặn `!`, "Chờ duyệt: ..." | `trực tiếp` |
| rảnh (`available`) | Ngủ zzz. Task vừa xong dưới 3 phút thì ăn mừng "Xong", vừa lỗi thì `!` | `trực tiếp` |
| chưa cài / chưa đăng nhập / tắt | Ngủ zzz kèm lý do | `trực tiếp` |
| `generatedAt` quá cũ | Tất cả ngủ zzz, "DevHub chưa gửi dữ liệu mới" | `dữ liệu cũ` |
| không tải được nguồn | Giữ danh sách cũ, tất cả ngủ zzz, "Mất kết nối DevHub" | `mất kết nối` |
| chưa từng tải được | Dùng các bot `dh-*` có trong `status.json` (cập nhật bằng `update-status.mjs --bot dh-claude ...`) | `dùng status.json` |

File `devhub-status.json` trong repo hiện chỉ là danh sách agent (state `unknown`, không bịa dữ liệu): 5 bàn DevHub ngủ với dòng "Chưa có dữ liệu từ DevHub" cho tới khi bộ xuất ghi đè file này. Định dạng đầy đủ: `schema: "devhub-office/1"`, xem `docs/GROK-OFFICE.md` trong nexa-devhub.

Kiểm thử: `node tests/serve.cjs 8123 &` rồi `node tests/devhub.cjs` (22 kiểm tra), cùng `crowd.cjs`, `dyn.cjs`, `daynight.cjs`, `zoom.cjs`. Ảnh: `shots/devhub-office.png`, `shots/devhub-desks.png`.

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


## Thành phố và ngày đêm

- Bên ngoài là thành phố low-poly: nhà chọc trời có cửa sổ sáng đèn về đêm, đường phố với xe chạy (dừng đèn đỏ, bật đèn pha về đêm), đèn giao thông, người đi bộ trên vỉa hè, đèn đường. Phía xa là đường chân trời với skyline.
- Bên trong: đèn trần treo trên các thanh ray, tự bật khi trời tối (cả đèn điểm chiếu sáng nền nhà).
- Chu kỳ ngày đêm theo giờ thật Asia/Bangkok (mặc định). Bầu trời, mặt trời / mặt trăng + sao, ánh sáng, cửa sổ nhà cao tầng, đèn pha xe đều đổi theo giờ.
- Tham số URL: `?time=day` (13:00), `?time=night` (23:30), `?time=cycle` (chạy nhanh 1 ngày = 72 giây, đổi bằng `&speed=<giây>`), `?hour=18.5` hoặc `?time=18.5` (ghim 1 giờ cụ thể). Khi ở chế độ demo, đồng hồ ở HUD hiện giờ mô phỏng kèm nhãn "(demo ...)".
- Điện thoại / màn hình hẹp: ít xe và người hơn, bóng đổ 1024, pixel ratio tối đa 1.5, khung hình tập trung vào văn phòng. `?quality=low` ép chế độ nhẹ.
- Kiểm tra: `node tests/serve.cjs` rồi `node tests/daynight.cjs`.

## Zoom và giao diện vàng đen

- Cuộn chuột để zoom (mượt, có easing, giới hạn 0.16x-1.25x), zoom về phía con trỏ. Cảm ứng: chụm 2 ngón. Kéo để di chuyển khi đã zoom vào.
- Nút `+` / `-` và `TOÀN CẢNH`; nhấp đúp (double-click) để reset về toàn cảnh.
- UI HTML dùng bảng màu đen và vàng lấy từ design tokens của DevHub (`packages/ui/src/tokens.css` trong Roccat92/nexa-devhub): nền `#080B0B`, bề mặt `#121212`, nhấn `#ffc629`. Cảnh 3D không đổi.
- Test: `node tests/zoom.cjs` (cần server tại :8123).
