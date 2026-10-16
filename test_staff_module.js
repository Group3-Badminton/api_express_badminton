const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const BASE_URL = 'http://localhost:9999/api';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 BẮT ĐẦU KIỂM CHỨNG TOÀN DIỆN MODULE QUẢN LÝ NHÂN VIÊN');
  console.log('====================================================\n');

  // 1. Authenticate Admin and Customer
  console.log('--- 1. Kiểm tra Đăng nhập & Tạo Token ---');
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: { account: 'admin@gmail.com', password: '123456' }
  });
  assert(adminLogin.status === 200 && adminLogin.data.data?.token, 'Admin đăng nhập thành công và có JWT token');
  const adminToken = adminLogin.data.data.token;
  const adminId = adminLogin.data.data.user._id;

  const customerLogin = await request('/auth/login', {
    method: 'POST',
    body: { account: 'customer@gmail.com', password: '123456' }
  });
  assert(customerLogin.status === 200 && customerLogin.data.data?.token, 'Customer đăng nhập thành công và có JWT token');
  const customerToken = customerLogin.data.data.token;
  const customerId = customerLogin.data.data.user._id;

  // 2. RBAC Access Control
  console.log('\n--- 2. Kiểm tra Phân quyền RBAC (BR-02, BR-07) ---');
  const noTokenReq = await request('/staffs');
  assert(noTokenReq.status === 401, 'Không có token bị từ chối 401');

  const customerGetStaffs = await request('/staffs', {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(customerGetStaffs.status === 403, 'Customer truy cập /api/staffs bị từ chối 403');

  const customerPostStaff = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
    body: { fullName: 'Hacker', email: 'hack@gmail.com', phone: '0912345678', password: 'password123' }
  });
  assert(customerPostStaff.status === 403, 'Customer tạo nhân viên bị từ chối 403');

  // 3. UC-8.1 View Staff List
  console.log('\n--- 3. Kiểm tra UC-8.1 View Staff List ---');
  const staffListRes = await request('/staffs', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(staffListRes.status === 200 && staffListRes.data.success, 'Admin lấy danh sách nhân viên thành công 200');
  assert(Array.isArray(staffListRes.data.data), 'Danh sách trả về mảng');
  const initialStaffCount = staffListRes.data.data.length;
  console.log(`     (Số nhân viên hiện có: ${initialStaffCount})`);

  // Ensure no Admin or Customer is in staff list
  const hasNonStaff = staffListRes.data.data.some(u => u.role !== 'STAFF');
  assert(!hasNonStaff, 'Danh sách không chứa tài khoản ADMIN hoặc CUSTOMER');

  // 4. UC-8.3 Create Staff
  console.log('\n--- 4. Kiểm tra UC-8.3 Create Staff (Validation, Conflict & Hash) ---');
  // Validation errors
  const invalidEmpty = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { fullName: '   ', email: 'invalid-email', phone: '12345', password: '123' }
  });
  assert(invalidEmpty.status === 400 && invalidEmpty.data.errors, 'Dữ liệu không hợp lệ trả 400 với errors');
  assert(invalidEmpty.data.errors.fullName, 'Có lỗi trường fullName');
  assert(invalidEmpty.data.errors.email, 'Có lỗi trường email');
  assert(invalidEmpty.data.errors.phone, 'Có lỗi trường phone');
  assert(invalidEmpty.data.errors.password, 'Có lỗi trường password');

  // Duplicate email with Admin
  const dupEmail = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { fullName: 'Trùng Email', email: 'admin@gmail.com', phone: '0911223344', password: 'password123' }
  });
  assert(dupEmail.status === 409 && dupEmail.data.errors?.email, 'Trùng email trả 409 conflict');

  // Duplicate phone with Customer
  const dupPhone = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { fullName: 'Trùng SĐT', email: 'unique.test1@gmail.com', phone: '0901234567', password: 'password123' }
  });
  assert(dupPhone.status === 409 && dupPhone.data.errors?.phone, 'Trùng SĐT trả 409 conflict');

  // Create Staff 1 successfully
  const testStaff1Email = `test.staff.${Date.now()}@gmail.com`;
  const testStaff1Phone = '0981112233';
  const createStaff1 = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      fullName: 'Nhân Viên Kiểm Thử 1',
      email: testStaff1Email,
      phone: testStaff1Phone,
      password: 'staffpassword123',
      role: 'ADMIN', // Client tries to supply ADMIN - backend must ignore and force STAFF
      status: 'LOCKED' // Client tries to supply LOCKED - backend must ignore and force ACTIVE
    }
  });
  assert(createStaff1.status === 201 && createStaff1.data.success, 'Tạo nhân viên thành công 201');
  const staff1 = createStaff1.data.data;
  assert(staff1.role === 'STAFF', 'Role được cố định là STAFF (bỏ qua input client)');
  assert(staff1.status === 'ACTIVE', 'Status được cố định là ACTIVE (bỏ qua input client)');
  assert(!staff1.password && !staff1.resetOtp, 'Không trả về trường password hoặc resetOtp');

  // 5. UC-8.2 View Staff Detail
  console.log('\n--- 5. Kiểm tra UC-8.2 View Staff Detail ---');
  const getDetail = await request(`/staffs/${staff1._id}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(getDetail.status === 200 && getDetail.data.data._id === staff1._id, 'Lấy chi tiết nhân viên thành công 200');
  assert(!getDetail.data.data.password && !getDetail.data.data.resetOtp, 'Chi tiết không trả về password/resetOtp');

  // Try to view Admin or Customer as staff
  const getAdminAsStaff = await request(`/staffs/${adminId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(getAdminAsStaff.status === 404, 'Truy vấn tài khoản Admin qua /api/staffs/:id trả 404');
  assert(getAdminAsStaff.data.message === 'The selected staff account is unavailable.', 'Thông báo lỗi khớp chính xác UC: "The selected staff account is unavailable."');

  const getCustAsStaff = await request(`/staffs/${customerId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(getCustAsStaff.status === 404, 'Truy vấn tài khoản Customer qua /api/staffs/:id trả 404');

  const getInvalidId = await request('/staffs/invalid-id-12345', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(getInvalidId.status === 404, 'Id không hợp lệ trả 404');

  // 6. UC-8.4 Update Staff
  console.log('\n--- 6. Kiểm tra UC-8.4 Update Staff ---');
  const updateValidation = await request(`/staffs/${staff1._id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { fullName: '', email: 'not-an-email', phone: '0123' }
  });
  assert(updateValidation.status === 400 && updateValidation.data.errors, 'Cập nhật với dữ liệu không hợp lệ trả 400');

  // Attempt to alter role, password, status via update
  const maliciousUpdate = await request(`/staffs/${staff1._id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      fullName: 'Nhân Viên 1 Đã Đổi Tên',
      email: staff1.email,
      phone: '0981112244',
      role: 'ADMIN',
      status: 'INACTIVE',
      password: 'newhackedpassword'
    }
  });
  assert(maliciousUpdate.status === 200, 'Cập nhật hợp lệ trả 200');
  assert(maliciousUpdate.data.data.fullName === 'Nhân Viên 1 Đã Đổi Tên', 'Họ tên được cập nhật');
  assert(maliciousUpdate.data.data.phone === '0981112244', 'Số điện thoại được cập nhật');
  assert(maliciousUpdate.data.data.role === 'STAFF', 'Role vẫn giữ nguyên STAFF (không bị đổi thành ADMIN)');
  assert(maliciousUpdate.data.data.status === 'ACTIVE', 'Status vẫn giữ nguyên ACTIVE (không bị đổi thành INACTIVE)');

  // Try updating Admin or Customer via staff update endpoint
  const updateAdmin = await request(`/staffs/${adminId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { fullName: 'Hacked Admin', email: 'admin@gmail.com', phone: '0909999999' }
  });
  assert(updateAdmin.status === 404, 'Không thể cập nhật Admin qua endpoint /api/staffs/:id (404)');

  // 7. UC-8.5 Deactivate Staff & Security Post-conditions
  console.log('\n--- 7. Kiểm tra UC-8.5 Deactivate Staff & Hậu điều kiện bảo mật ---');
  // First, verify the staff can log in while ACTIVE
  const staffLoginActive = await request('/auth/login', {
    method: 'POST',
    body: { account: testStaff1Email, password: 'staffpassword123' }
  });
  assert(staffLoginActive.status === 200, 'Nhân viên ACTIVE đăng nhập thành công');
  const staffToken = staffLoginActive.data.data.token;

  // Verify staffToken can call /api/users/profile
  const staffProfileBefore = await request('/users/profile', {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffProfileBefore.status === 200, 'Staff token truy cập được /api/users/profile khi ACTIVE');

  // Now, Admin deactivates staff 1
  const deactivateRes = await request(`/staffs/${staff1._id}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(deactivateRes.status === 200 && deactivateRes.data.success, 'Vô hiệu hóa nhân viên thành công 200');
  assert(deactivateRes.data.data.status === 'INACTIVE', 'Trạng thái chuyển thành INACTIVE');
  assert(deactivateRes.data.data._id === staff1._id, 'Giữ nguyên _id và bản ghi');

  // Verify staff list still includes INACTIVE staff (UC-8.1 requirement)
  const staffListAfter = await request('/staffs', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const foundInactiveStaff = staffListAfter.data.data.find(s => s._id === staff1._id);
  assert(foundInactiveStaff && foundInactiveStaff.status === 'INACTIVE', 'Nhân viên INACTIVE vẫn xuất hiện trong danh sách nhân viên');

  // Test idempotency: deactivating already inactive staff
  const deactivateAgain = await request(`/staffs/${staff1._id}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(deactivateAgain.status === 200, 'Vô hiệu hóa lại tài khoản đã INACTIVE trả 200 thành công (idempotent)');

  // POST-CONDITION 1: Deactivated staff CANNOT log in
  const staffLoginInactive = await request('/auth/login', {
    method: 'POST',
    body: { account: testStaff1Email, password: 'staffpassword123' }
  });
  assert(staffLoginInactive.status === 403, 'Tài khoản INACTIVE không thể đăng nhập (bị chặn 403)');

  // POST-CONDITION 2: OLD TOKEN of deactivated staff is REJECTED by authMiddleware
  const staffProfileAfter = await request('/users/profile', {
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(staffProfileAfter.status === 403, 'Token cũ của nhân viên đã INACTIVE bị từ chối 403 bởi authMiddleware');

  // POST-CONDITION 3: Public register CANNOT overwrite or reactivate deactivated staff
  const bypassRegister = await request('/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Attacker Impersonator',
      email: testStaff1Email,
      phone: '0981999999',
      password: 'newpassword123'
    }
  });
  assert(bypassRegister.status === 400, 'Public register không thể ghi đè hoặc đăng ký lại email của nhân viên INACTIVE (400)');

  // Try deactivating Admin or Customer -> 404
  const deactivateAdmin = await request(`/staffs/${adminId}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(deactivateAdmin.status === 404, 'Không thể vô hiệu hóa Admin qua /api/staffs/:id/deactivate (404)');

  // 7.1. Kiểm tra Mở khóa / Kích hoạt lại nhân viên (Activate Staff)
  console.log('\n--- 7.1. Kiểm tra Mở khóa / Kích hoạt lại nhân viên ---');
  const activateRes = await request(`/staffs/${staff1._id}/activate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(activateRes.status === 200 && activateRes.data.success, 'Mở khóa nhân viên thành công 200');
  assert(activateRes.data.data.status === 'ACTIVE', 'Trạng thái nhân viên chuyển lại thành ACTIVE');

  // Verify staff can now log in again
  const staffLoginReactivated = await request('/auth/login', {
    method: 'POST',
    body: { account: testStaff1Email, password: 'staffpassword123' }
  });
  assert(staffLoginReactivated.status === 200, 'Nhân viên sau khi mở khóa đăng nhập lại thành công');

  // Verify newly issued token works
  const newStaffToken = staffLoginReactivated.data.data.token;
  const staffProfileReactivated = await request('/users/profile', {
    headers: { Authorization: `Bearer ${newStaffToken}` }
  });
  assert(staffProfileReactivated.status === 200, 'Token mới của nhân viên đã mở khóa truy cập được API bảo vệ');

  // Test idempotency of activate
  const activateAgain = await request(`/staffs/${staff1._id}/activate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(activateAgain.status === 200, 'Mở khóa lại tài khoản đã ACTIVE trả 200 thành công (idempotent)');

  // Try activating with customer token -> 403
  const customerActivate = await request(`/staffs/${staff1._id}/activate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(customerActivate.status === 403, 'Customer gọi API mở khóa bị từ chối 403');

  // Đưa staff 1 về lại INACTIVE để các bài kiểm thử lọc UC-8.6 phía sau chạy nhất quán
  await request(`/staffs/${staff1._id}/deactivate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // 8. UC-8.6 Search/Filter Staff & BR-38
  console.log('\n--- 8. Kiểm tra UC-8.6 Search/Filter Staff & BR-38 ---');
  // Tạo thêm 1 nhân viên ACTIVE để kiểm tra lọc và tìm kiếm phong phú
  const testStaff2Email = `test.staff.linh.${Date.now()}@gmail.com`;
  const createStaff2 = await request('/staffs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      fullName: 'Trần Thị Mỹ Linh',
      email: testStaff2Email,
      phone: '0977889900',
      password: 'password123'
    }
  });
  assert(createStaff2.status === 201, 'Tạo thêm nhân viên thứ 2 (ACTIVE) thành công');
  const staff2 = createStaff2.data.data;

  // 8.1. Tìm kiếm theo tên chính xác & không phân biệt hoa/thường
  const searchNameUpper = await request('/staffs?search=' + encodeURIComponent('TRẦN THỊ MỸ LINH'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchNameUpper.status === 200, 'Tìm kiếm tên chữ hoa thành công 200');
  assert(searchNameUpper.data.data.some(s => s._id === staff2._id), 'Tìm thấy nhân viên theo tên chữ hoa');

  // 8.2. Tìm kiếm tên khớp một phần
  const searchNamePartial = await request('/staffs?search=' + encodeURIComponent('Mỹ Linh'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchNamePartial.status === 200, 'Tìm kiếm tên khớp một phần thành công 200');
  assert(searchNamePartial.data.data.every(s => s.fullName.includes('Mỹ Linh')), 'Tất cả kết quả khớp một phần tên');

  // 8.3. Tìm kiếm theo số điện thoại đầy đủ & một phần
  const searchPhoneFull = await request('/staffs?search=0977889900', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchPhoneFull.status === 200 && searchPhoneFull.data.data.some(s => s._id === staff2._id), 'Tìm kiếm SĐT đầy đủ thành công');

  const searchPhonePartial = await request('/staffs?search=8899', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchPhonePartial.status === 200 && searchPhonePartial.data.data.some(s => s._id === staff2._id), 'Tìm kiếm SĐT một phần thành công');

  // 8.4. Lọc theo trạng thái
  const filterActive = await request('/staffs?status=ACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(filterActive.status === 200, 'Lọc status=ACTIVE thành công');
  assert(filterActive.data.data.every(s => s.status === 'ACTIVE'), 'Tất cả kết quả đều có status ACTIVE');
  assert(filterActive.data.data.some(s => s._id === staff2._id), 'Chứa nhân viên ACTIVE');
  assert(!filterActive.data.data.some(s => s._id === staff1._id), 'Không chứa nhân viên INACTIVE');

  const filterInactive = await request('/staffs?status=INACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(filterInactive.status === 200, 'Lọc status=INACTIVE thành công');
  assert(filterInactive.data.data.every(s => s.status === 'INACTIVE'), 'Tất cả kết quả đều có status INACTIVE');
  assert(filterInactive.data.data.some(s => s._id === staff1._id), 'Chứa nhân viên INACTIVE');

  // 8.5. Kết hợp Từ khóa VÀ Trạng thái
  // Tìm "Nhân Viên" (tên của staff 1 vốn là INACTIVE) nhưng lọc status=ACTIVE -> Phải rỗng
  const searchAndFilterNoMatch = await request('/staffs?search=' + encodeURIComponent('Nhân Viên') + '&status=ACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchAndFilterNoMatch.status === 200 && searchAndFilterNoMatch.data.data.length === 0, 'Kết hợp từ khóa + trạng thái không khớp trả mảng rỗng 200');

  // Tìm "Nhân Viên" VÀ status=INACTIVE -> Phải thấy staff 1
  const searchAndFilterMatch = await request('/staffs?search=' + encodeURIComponent('Nhân Viên') + '&status=INACTIVE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchAndFilterMatch.status === 200 && searchAndFilterMatch.data.data.some(s => s._id === staff1._id), 'Kết hợp từ khóa + trạng thái khớp trả đúng bản ghi');

  // 8.6. Luồng thay thế A1: Không có kết quả phù hợp -> trả [] thành công 200
  const searchEmpty = await request('/staffs?search=' + encodeURIComponent('KhongTonTaiNhanVienNao12345'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchEmpty.status === 200 && Array.isArray(searchEmpty.data.data) && searchEmpty.data.data.length === 0, 'A1: Không có kết quả trả về mảng rỗng [] với 200 OK');

  // 8.7. Luồng thay thế A2: Xóa tiêu chí / Tất cả trạng thái -> trả danh sách không lọc
  const clearFilter1 = await request('/staffs?search=&status=', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(clearFilter1.status === 200 && clearFilter1.data.data.length >= 2, 'A2: Xóa tiêu chí trả lại danh sách đầy đủ');

  const clearFilter2 = await request('/staffs?status=ALL', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(clearFilter2.status === 200 && clearFilter2.data.data.length >= 2, 'status=ALL trả lại danh sách tất cả trạng thái');

  // 8.8. Ký tự đặc biệt Regex được xử lý như văn bản thường (không crash / không injection)
  const regexSearch = await request('/staffs?search=' + encodeURIComponent('.*+?^${}()|[]\\'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(regexSearch.status === 200, 'Từ khóa chứa ký tự đặc biệt Regex được escape an toàn và trả 200');

  // 8.9. Validation query params
  const invalidStatusQuery = await request('/staffs?status=INVALID_STATUS_VALUE', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(invalidStatusQuery.status === 400, 'Status ngoài enum bị từ chối 400');

  const tooLongSearch = await request('/staffs?search=' + 'a'.repeat(101), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(tooLongSearch.status === 400, 'Từ khóa dài quá 100 ký tự bị từ chối 400');

  // 8.10. Business Rule BR-38: Kết quả KHÔNG BAO GIỜ chứa ADMIN hoặc CUSTOMER
  // Tìm từ khóa tên của Admin ("Quản Trị Viên") -> Kết quả phải rỗng
  const searchAdminKeyword = await request('/staffs?search=' + encodeURIComponent('Quản Trị Viên Sân'), {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchAdminKeyword.status === 200 && searchAdminKeyword.data.data.length === 0, 'BR-38: Tìm kiếm tên Admin không trả về tài khoản Admin');

  // Tìm từ khóa SĐT của Customer ("0901234567") -> Kết quả phải rỗng
  const searchCustomerPhone = await request('/staffs?search=0901234567', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(searchCustomerPhone.status === 200 && searchCustomerPhone.data.data.length === 0, 'BR-38: Tìm kiếm SĐT Customer không trả về tài khoản Customer');

  // Customer không thể gọi endpoint search/filter
  const customerSearch = await request('/staffs?search=Linh', {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  assert(customerSearch.status === 403, 'BR-38: Customer gọi tìm kiếm bị từ chối 403');

  // 9. Dọn dẹp dữ liệu kiểm thử
  console.log('\n--- 9. Dọn dẹp dữ liệu kiểm thử ---');
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    const User = require('./src/models/user');
    const deleteResult = await User.deleteMany({ email: { $regex: /^test\.staff\./ } });
    console.log(`     (Đã xóa ${deleteResult.deletedCount} tài khoản kiểm thử test.staff.*)`);
    await mongoose.disconnect();
    assert(true, 'Dọn dẹp tài khoản kiểm thử thành công, giữ nguyên các tài khoản chính');
  } catch (err) {
    console.error('Lỗi dọn dẹp:', err);
  }

  console.log('\n====================================================');
  console.log(`KẾT QUẢ: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
