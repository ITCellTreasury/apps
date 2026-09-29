/* =========================================================
   INTERNAL MAILBOX API CLIENT
   ========================================================= */

const MAILBOX_API_URL =
  window.MAILBOX_API_URL ||
  'https://script.google.com/macros/s/AKfycbztFYkp6V7YglnFLtZ7GbEXzoctYiBilV4lA4VgLm3WFKF8lYENWdM90_zy0uC1gmdG/exec';


const MailboxAPI = (() => {

  async function request(
    action,
    payload = {}
  ) {

    const body =
      Object.assign(
        { action },
        payload
      );

    const response =
      await fetch(
        MAILBOX_API_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'text/plain;charset=utf-8'
          },

          body:
            JSON.stringify(body),

          redirect: 'follow'
        }
      );

    if (!response.ok) {
      throw new Error(
        'Server error: ' +
        response.status
      );
    }

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        data.error ||
        'Request failed.'
      );
    }

    return data;
  }


  function token() {

    return (
      sessionStorage
        .getItem(
          'mailbox_token'
        ) || ''
    );
  }


  function user() {

    try {

      return JSON.parse(
        sessionStorage.getItem(
          'mailbox_user'
        ) || 'null'
      );

    } catch (_) {

      return null;
    }
  }


  function setSession(data) {

    sessionStorage.setItem(
      'mailbox_token',
      data.token
    );

    sessionStorage.setItem(
      'mailbox_user',
      JSON.stringify(
        data.user
      )
    );
  }


  function clearSession() {

    sessionStorage.removeItem(
      'mailbox_token'
    );

    sessionStorage.removeItem(
      'mailbox_user'
    );
  }


  function requireLogin() {

    if (!token()) {
      location.href =
        'login.html';
    }
  }


  return {

    request,

    token,

    user,

    setSession,

    clearSession,

    requireLogin,


    login:
      (email, password) =>
        request(
          'login',
          {
            email,
            password
          }
        ),


    logout:
      () =>
        request(
          'logout',
          {
            token:
              token()
          }
        ),


    bootstrap:
      () =>
        request(
          'bootstrap',
          {
            token:
              token()
          }
        ),


    /*
     * NEW PAGINATED MAILBOX ACTION
     */
    list:
      (
        folder,
        search = '',
        page = 1,
        pageSize = 25
      ) =>
        request(
          'mailbox',
          {
            token:
              token(),

            folder,

            search,

            page,

            pageSize
          }
        ),


    get:
      mailId =>
        request(
          'getMessage',
          {
            token:
              token(),
            mailId
          }
        ),


    suggestRecipients:
      query =>
        request(
          'suggestRecipients',
          {
            token:
              token(),
            query
          }
        ),


    send:
      payload =>
        request(
          'sendMessage',
          Object.assign(
            {
              token:
                token()
            },
            payload
          )
        ),


    draft:
      payload =>
        request(
          'saveDraft',
          Object.assign(
            {
              token:
                token()
            },
            payload
          )
        ),


    update:
      payload =>
        request(
          'updateMessage',
          Object.assign(
            {
              token:
                token()
            },
            payload
          )
        )

  };

})();