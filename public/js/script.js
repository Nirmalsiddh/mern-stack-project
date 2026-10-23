// Example starter JavaScript for disabling form submissions if there are invalid fields
(() => {
    'use strict'
  
    // Fetch all the forms we want to apply custom Bootstrap validation styles to
    const forms = document.querySelectorAll('.needs-validation')
  
    // Loop over them and prevent submission
    Array.from(forms).forEach(form => {
      form.addEventListener('submit', event => {
        if (!form.checkValidity()) {
          event.preventDefault()
          event.stopPropagation()
        }
  
        form.classList.add('was-validated')
      }, false)
    })

    const taxSwitch = document.getElementById("flexSwitchCheckDefault");
    if (taxSwitch) {
        taxSwitch.addEventListener("change", () => {
            for (const info of document.getElementsByClassName("tax-info")) {
                info.style.display = taxSwitch.checked ? "inline" : "none";
            }
        });
    }
})();
