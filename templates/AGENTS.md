# <Tên dự án>

## Commands
- Build: `<lệnh>`
- Test: `<lệnh>` (một test: `<lệnh>`)
- Lint: `<lệnh>`

## Conventions
- <quy ước mà người mới phải biết ngày đầu>

## Architecture
- <thư mục → trách nhiệm; các luồng phải đọc nhiều file mới hiểu>

## Verifying your work
- Chạy build, test, lint ở trên trước khi báo xong và dán output.
- Test đỏ thì sửa code, không sửa hay xóa test.

## Things agents get wrong
- <lỗi agent lặp lại lần thứ hai được ghi vào đây>

## SDLC harness
Repo dùng ai-native-sdlc. Mỗi thay đổi nằm trong `sdlc/changes/<date>-<slug>/` (intent → spec → plan → review, trạng thái ở progress.md). Đọc progress.md của change trước khi làm tiếp. Bài học sự cố ở `sdlc/lessons/`.
