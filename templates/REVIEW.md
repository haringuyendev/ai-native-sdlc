# Review instructions

## Passes
Chạy ba pass, gắn nhãn pass cho mỗi finding:
- Bugs: lỗi logic, edge case hỏng, regression tinh vi
- Security: injection, lỗ hổng xác thực/phân quyền, dữ liệu cá nhân trong log
- Compliance: thay đổi khớp spec.md, plan.md của change và các policy skill

## What Important means here
Important chỉ dành cho finding làm hỏng hành vi, rò rỉ dữ liệu hoặc vi phạm policy. Style và đặt tên là Nit.

## Cap the nits
Tối đa 5 nit mỗi lần review; phần còn lại ghi thành số đếm.

## Do not report
Code generated và những gì lint/CI đã kiểm tra.
